// SPDX-License-Identifier: GPL-3.0-or-later
// Classic DOM adapter. Geometry/conversion helpers are from ComfyUI_frontend.
import { applyDrag, boxesAt, fromBoundingBoxes, toBoundingBoxes, tagRects } from "./geometry.js";
import { openColorPicker } from "./color-picker.js";
import { objectTokenOptions } from "./object-tokens.js";
import { attachObjectCompletion } from "./object-completion.js";

const copy = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value) => Math.max(0, Math.min(1, value));
const zh = {
    grid: "网格", clear: "全部清除", region: "选择区域", text: "文字",
    desc: "描述", palette: "调色板", add: "+", remove: "删除", canvas: "边界框绘制画布",
    swatch: "点击编辑 · 拖动排序 · 右键删除",
    failed: "背景预览加载失败，请运行节点以刷新。",
};
const en = {
    grid: "Grid", clear: "Clear all", region: "Select region", text: "Text",
    desc: "Description", palette: "Palette", add: "+", remove: "Delete", canvas: "Bounding box drawing canvas",
    swatch: "Click to edit · drag to reorder · right-click to remove",
    failed: "Could not load the background preview. Run the node to refresh it.",
};

function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
}

export class ClassicBoundingBoxesEditor {
    constructor(node, stateWidget, incomingWidget, app, api) {
        Object.assign(this, { node, stateWidget, incomingWidget, app, api });
        const locale = app.ui?.settings?.getSettingValue?.("Comfy.Locale") ?? navigator.language;
        this.t = String(locale).toLowerCase().startsWith("zh") ? zh : en;
        this.active = -1;
        this.regions = [];
        this.drag = null;
        this.grid = node.properties?.classicBBoxGrid !== false;
        this.background = null;
        this.backgroundURL = "";
        this.loadGeneration = 0;
        this.abort = new AbortController();
        this.inputCompletions = new Set();
        this.root = element("div", "classic-bbox");
        this.root.dataset.testid = "classic-bbox-editor";
        this.build();
        this.observer = new ResizeObserver(() => this.draw());
        this.observer.observe(this.stage);
        this.layoutObserver = new ResizeObserver(() => this.layout());
        this.layoutObserver.observe(this.root);
        this.layoutObserver.observe(this.panel);
        // A cheap per-editor source check; no canvas or core prototypes are patched.
        this.timer = setInterval(() => this.checkSources(), 700);
        this.restore();
    }

    listen(target, name, callback, options = {}) {
        target.addEventListener(name, callback, { ...options, signal: this.abort.signal });
    }

    button(label, callback, parent) {
        const button = element("button", "", label);
        button.type = "button";
        this.listen(button, "click", callback);
        parent.append(button);
        return button;
    }

    build() {
        // Keep editing gestures out of LiteGraph's drag and hotkey handlers.
        for (const name of ["pointerdown", "pointermove", "pointerup", "click", "dblclick", "contextmenu", "keydown", "keyup"]) {
            this.listen(this.root, name, (event) => event.stopPropagation());
        }
        this.listen(this.root, "wheel", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.setRegionListOpen(false);
            // DOM widgets sit above (rather than inside) the graph canvas.
            // Forward wheel input to the real canvas so ComfyUI retains its
            // own zoom anchor, trackpad handling, modifiers and zoom limits.
            const graphCanvas = this.app.canvas?.canvas ?? this.app.canvasEl;
            graphCanvas?.dispatchEvent(new WheelEvent("wheel", {
                bubbles: true, cancelable: true, composed: true, view: window,
                clientX: event.clientX, clientY: event.clientY,
                screenX: event.screenX, screenY: event.screenY,
                deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ,
                deltaMode: event.deltaMode, ctrlKey: event.ctrlKey,
                shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
            }));
        }, { passive: false });

        const toolbar = this.toolbar = element("div", "cb-toolbar");
        this.gridButton = this.button(this.t.grid, () => {
            this.grid = !this.grid;
            this.node.properties.classicBBoxGrid = this.grid;
            this.renderButtons();
            this.changed();
        }, toolbar);
        this.deleteButton = this.button(this.t.remove, () => this.removeActive(), toolbar);
        this.deleteButton.classList.add("cb-delete");
        this.clearButton = this.button(this.t.clear, () => {
            if (!this.regions.length) return;
            this.regions = [];
            this.active = -1;
            this.commit();
            this.renderPanel();
        }, toolbar);
        this.clearButton.classList.add("cb-clear");

        this.stage = element("div", "cb-stage");
        // Let the browser composite the original image at the final zoom level,
        // rather than enlarging a small intermediate canvas bitmap.
        this.backgroundImage = element("img", "cb-background");
        this.backgroundImage.alt = "";
        this.backgroundImage.draggable = false;
        if (this.background) this.backgroundImage.src = this.background.src;
        this.canvas = element("canvas");
        this.canvas.tabIndex = 0;
        this.canvas.setAttribute("aria-label", this.t.canvas);
        this.stage.append(this.backgroundImage, this.canvas);
        this.listen(this.canvas, "pointerdown", (event) => this.pointerDown(event));
        this.listen(this.canvas, "pointermove", (event) => this.pointerMove(event));
        this.listen(this.canvas, "pointerup", (event) => this.pointerUp(event));
        this.listen(this.canvas, "pointercancel", (event) => this.pointerUp(event, true));
        this.listen(this.canvas, "lostpointercapture", () => {
            if (this.drag) this.finishDrag(true);
        });
        this.listen(this.canvas, "keydown", (event) => {
            if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                this.removeActive();
            }
            if (event.key === "Escape" && this.drag) this.finishDrag(true);
        });
        this.panel = element("div", "cb-editor");
        this.root.append(toolbar, this.stage, this.panel);
        this.listen(document, "pointermove", event => this.movePalette(event), { capture: true });
        this.listen(document, "pointerup", () => { this.paletteDrag = null; }, { capture: true });
        this.listen(document, "pointercancel", () => { this.paletteDrag = null; }, { capture: true });
        this.listen(document, "pointerdown", event => {
            if (this.selector && !this.selector.contains(event.target)) this.setRegionListOpen(false);
        }, { capture: true });
        this.renderButtons();
    }

    dimensions() {
        return {
            width: Number(this.node.widgets.find((w) => w.name === "width")?.value) || 1024,
            height: Number(this.node.widgets.find((w) => w.name === "height")?.value) || 1024,
        };
    }

    restore() {
        const { width, height } = this.dimensions();
        const value = this.stateWidget.value;
        this.regions = fromBoundingBoxes(Array.isArray(value) ? value : [], width, height);
        this.seenValue = JSON.stringify(value);
        this.seenDimensions = `${width}:${height}`;
        if (this.active >= this.regions.length) this.active = this.regions.length - 1;
        this.grid = this.node.properties?.classicBBoxGrid !== false;
        this.layout();
        this.renderButtons();
        this.renderPanel();
        const ref = this.node.properties?.classicBBoxBackground;
        if (ref) this.loadBackground(this.imageURL(ref));
        this.checkSources();
        requestAnimationFrame(() => this.layout());
    }

    beforeQueued() {
        if (JSON.stringify(this.stateWidget.value) !== this.seenValue) this.restore();
        this.commit(false);
        this.queuedState = JSON.stringify(this.stateWidget.value);
    }

    commit(notify = true) {
        const { width, height } = this.dimensions();
        this.stateWidget.value = toBoundingBoxes(this.regions, width, height);
        this.seenValue = JSON.stringify(this.stateWidget.value);
        if (notify) this.changed();
        this.draw();
    }

    changed() {
        this.node.setDirtyCanvas(true, true);
        this.node.graph?.change?.();
    }

    setDimensions(width, height) {
        const before = this.dimensions();
        // Match the official editor: image dimensions become a 16px canvas grid.
        const snap = (v) => Math.max(64, Math.min(16384, Math.round(v / 16) * 16));
        width = snap(width);
        height = snap(height);
        for (const [name, value] of Object.entries({ width, height })) {
            const widget = this.node.widgets.find((w) => w.name === name);
            if (widget && widget.value !== value) {
                widget.value = value;
                widget.callback?.(value);
            }
        }
        this.layout();
        this.seenDimensions = `${width}:${height}`;
        if (before.width !== width || before.height !== height) this.commit();
        this.draw();
    }

    checkSources() {
        if (!this.root.isConnected || this.drag) return;
        const locale = this.app.ui?.settings?.getSettingValue?.("Comfy.Locale") ?? navigator.language;
        const nextTranslations = String(locale).toLowerCase().startsWith("zh") ? zh : en;
        if (nextTranslations !== this.t) {
            this.t = nextTranslations;
            this.clearCompletions();
            this.setRegionListOpen(false);
            this.abort.abort();
            this.closePalette?.();
            this.abort = new AbortController();
            this.observer.disconnect();
            this.layoutObserver.disconnect();
            this.root.replaceChildren();
            this.build();
            this.observer.observe(this.stage);
            this.layoutObserver.observe(this.root);
            this.layoutObserver.observe(this.panel);
            this.renderPanel();
            this.layout();
        }
        const { width, height } = this.dimensions();
        const key = `${width}:${height}`;
        if (key !== this.seenDimensions) {
            // Official region geometry is normalized; resolution changes scale boxes.
            this.seenDimensions = key;
            this.layout();
            this.commit();
        } else if (JSON.stringify(this.stateWidget.value) !== this.seenValue) this.restore();

        const slot = this.node.inputs?.findIndex((input) => input.name === "background");
        const upstream = slot >= 0 ? this.node.getInputNode(slot) : null;
        if (!upstream) {
            if (this.hadBackgroundConnection) {
                this.hadBackgroundConnection = false;
                this.background = null;
                this.backgroundImage.removeAttribute("src");
                this.backgroundURL = "";
                this.loadGeneration++;
                delete this.node.properties.classicBBoxBackground;
                this.draw();
            }
            return;
        }
        this.hadBackgroundConnection = true;
        const image = upstream.widgets?.find((w) => w.name === "image")?.value;
        if (upstream.comfyClass === "LoadImage" && typeof image === "string" && image) {
            const match = /\s\[(input|output|temp)\]$/.exec(image);
            const filename = match ? image.slice(0, match.index) : image;
            this.loadBackground(this.imageURL({ filename, type: match?.[1] ?? "input", subfolder: "" }));
            return;
        }
        const sourceImage = upstream.imgs?.[upstream.imageIndex ?? 0] ?? upstream.imgs?.[0];
        if (sourceImage?.src) this.loadBackground(sourceImage.src);
    }

    imageURL(ref) {
        const params = new URLSearchParams({ filename: ref.filename, type: ref.type ?? "input", subfolder: ref.subfolder ?? "" });
        return this.api.apiURL(`/view?${params}`);
    }

    loadBackground(url) {
        if (url) {
            const original = new URL(url, window.location.href);
            const params = original.searchParams;
            // Upstream thumbnails can request lossy/reduced previews. For a
            // ComfyUI /view reference, fetch the original file instead.
            if (original.origin === window.location.origin && original.pathname.endsWith("/view")) {
                params.delete("preview");
                params.delete("channel");
                url = original.href;
            }
            const filename = params.get("filename");
            if (filename) this.node.properties.classicBBoxBackground = {
                filename, type: params.get("type") ?? "input", subfolder: params.get("subfolder") ?? "",
            };
        }
        if (!url || url === this.backgroundURL) return;
        this.backgroundURL = url;
        const generation = ++this.loadGeneration;
        const image = new Image();
        image.onload = () => {
            if (generation !== this.loadGeneration) return;
            this.background = image;
            this.backgroundImage.src = image.src;
            this.canvas.removeAttribute("title");
            this.setDimensions(image.naturalWidth, image.naturalHeight);
        };
        image.onerror = () => {
            if (generation !== this.loadGeneration) return;
            this.background = null;
            this.backgroundImage.removeAttribute("src");
            this.canvas.title = this.t.failed;
            this.draw();
        };
        image.src = url;
    }

    onExecuted(output) {
        const incoming = output.input_bboxes;
        if (Array.isArray(incoming) && JSON.stringify(incoming) !== JSON.stringify(this.incomingWidget.value)) {
            if (!this.queuedState || JSON.stringify(this.stateWidget.value) === this.queuedState) {
                this.stateWidget.value = copy(incoming);
                this.restore();
            }
            // A newer local edit still takes priority over the just-completed run.
            this.incomingWidget.value = copy(incoming);
        }
        const background = output.background_images?.[0];
        if (background) {
            this.node.properties.classicBBoxBackground = copy(background);
            this.loadBackground(this.imageURL(background));
        }
    }

    renderButtons() {
        this.gridButton.setAttribute("aria-pressed", String(this.grid));
        this.deleteButton.disabled = !this.regions[this.active];
        this.clearButton.disabled = !this.regions.length;
    }

    previewSize() {
        const { width, height } = this.dimensions();
        const editorWidth = this.root.clientWidth || this.node.size[0] - 20;
        const scale = Math.min(Math.min(300, Math.max(1, editorWidth - 16)) / width, 260 / height);
        return { width: Math.max(1, width * scale), height: Math.max(1, height * scale) };
    }

    minimumHeight() {
        return Math.ceil(32 + (this.toolbar?.offsetHeight || 28)
            + (this.panel?.hidden ? 0 : this.panel?.scrollHeight || 0) + this.previewSize().height);
    }

    layout() {
        if (!this.root.isConnected) return;
        // Reflow on width changes as well as typing, so wrapped Chinese text
        // remains fully visible when the node is made narrower.
        for (const input of this.panel.querySelectorAll("textarea")) {
            input.style.height = "0px";
            input.style.height = `${Math.max(60, input.scrollHeight + 2)}px`;
        }
        // Image size depends only on node width and source aspect ratio. Extra
        // text fields must grow the node rather than take space from the image.
        const preview = this.previewSize();
        this.stage.style.width = `${preview.width}px`;
        this.stage.style.height = `${preview.height}px`;
        const required = this.minimumHeight();
        const rootHeight = this.root.clientHeight;
        if (rootHeight > 0 && required > rootHeight + 1 && !this.app.configuringGraph) {
            // DOM allocation updates asynchronously. Request each measured
            // deficit once so repeated layout passes cannot inflate the node.
            const key = `${this.root.clientWidth}:${rootHeight}:${required}`;
            if (key !== this.resizeRequest) {
                this.resizeRequest = key;
                this.node.setSize([this.node.size[0], this.node.size[1] + required - rootHeight]);
            }
        } else {
            this.resizeRequest = null;
        }
        this.draw();
    }

    renderPanel() {
        this.clearCompletions();
        this.closePalette?.();
        this.setRegionListOpen(false);
        this.renderButtons();
        this.panel.replaceChildren();
        this.panel.hidden = !this.regions.length;
        if (!this.regions.length) { this.layout(); return; }
        if (this.active < 0) this.active = 0;
        const selector = this.selector = element("div", "cb-region-selector");
        const regionLabel = (region, index) => `${String(index + 1).padStart(2, "0")} · ${region.type} · ${region.desc || region.text || "…"}`.slice(0, 100);
        const trigger = this.regionTrigger = this.button(regionLabel(this.regions[this.active], this.active), () => {
            this.setRegionListOpen(this.regionTrigger.getAttribute("aria-expanded") !== "true");
        }, selector);
        trigger.setAttribute("aria-label", this.t.region);
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        const list = this.regionList = element("div", "cb-region-list");
        // A top-layer popover never participates in the node's layout and is
        // not clipped by its DOM widget. Styling still inherits from the node.
        list.setAttribute("popover", "manual");
        list.setAttribute("role", "listbox");
        list.setAttribute("aria-label", this.t.region);
        list.hidden = true;
        this.listen(trigger, "keydown", event => {
            if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                this.setRegionListOpen(true);
                list.children[this.active]?.focus();
            }
            if (event.key === "Escape") this.setRegionListOpen(false);
        });
        this.listen(list, "keydown", event => {
            const index = [...list.children].indexOf(document.activeElement);
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? this.regions.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + this.regions.length) % this.regions.length;
                list.children[next]?.focus();
            }
            if (event.key === "Escape") { this.setRegionListOpen(false); trigger.focus(); }
        });
        this.regions.forEach((region, index) => {
            const option = this.button(regionLabel(region, index), () => {
                this.active = index;
                this.renderPanel();
                this.draw();
                this.regionTrigger.focus({ preventScroll: true });
            }, list);
            option.setAttribute("role", "option");
            option.setAttribute("aria-selected", String(index === this.active));
        });
        selector.append(list);
        this.panel.append(selector);
        const region = this.regions[this.active];
        if (!region) return;
        const tabs = element("div", "cb-tabs");
        const fields = element("div", "cb-fields");
        const typeButtons = [];
        const activateType = type => {
            const current = this.regions[this.active];
            if (!current || current.type === type) return;
            current.type = type;
            for (const button of typeButtons) button.setAttribute("aria-pressed", String(button.textContent === type));
            trigger.textContent = regionLabel(current, this.active);
            list.children[this.active].textContent = trigger.textContent;
            renderFields();
            this.commit();
        };
        for (const type of ["obj", "text"]) {
            const button = this.button(type, () => activateType(type), tabs);
            // Activate on the first press, retaining the actual button DOM while
            // the text fields reflow. Click remains the keyboard/AT fallback.
            this.listen(button, "pointerdown", event => {
                if (event.button !== 0) return;
                event.preventDefault();
                button.setPointerCapture(event.pointerId);
                activateType(type);
            });
            button.setAttribute("aria-pressed", String(region.type === type));
            typeButtons.push(button);
        }
        this.panel.append(tabs, fields);
        const field = (name, label) => {
            const wrapper = element("label", "cb-label", label);
            const input = element("textarea");
            input.value = region[name] ?? "";
            input.setAttribute("aria-label", label);
            const fit = () => this.layout();
            this.listen(input, "input", () => {
                this.regions[this.active][name] = input.value;
                trigger.textContent = regionLabel(this.regions[this.active], this.active);
                list.children[this.active].textContent = trigger.textContent;
                fit(); this.commit();
            });
            wrapper.append(input);
            fields.append(wrapper);
            this.inputCompletions.add(attachObjectCompletion(input, () => objectTokenOptions(this.regions), { chinese: this.t === zh }));
            requestAnimationFrame(fit);
        };
        const renderFields = () => {
            this.clearCompletions();
            fields.replaceChildren();
            if (this.regions[this.active].type === "text") field("text", this.t.text);
            field("desc", this.t.desc);
            this.layout();
        };
        renderFields();
        const palette = element("div", "cb-palette");
        palette.append(element("span", "", this.t.palette));
        region.palette.forEach((color, index) => {
            const swatch = this.button("", () => {
                if (Date.now() - (this.lastPaletteDrag || 0) < 300) return;
                this.closePalette?.();
                this.closePalette = openColorPicker(swatch, region.palette[index], next => {
                    region.palette[index] = next;
                    swatch.style.background = next;
                    this.commit();
                }, this.t === zh);
            }, palette);
            swatch.className = "cb-swatch";
            swatch.dataset.index = String(index);
            swatch.style.background = color;
            swatch.title = this.t.swatch;
            swatch.setAttribute("aria-label", `${this.t.palette} ${index + 1}`);
            this.listen(swatch, "contextmenu", event => {
                event.preventDefault();
                region.palette.splice(index, 1); this.commit(); this.renderPanel();
            });
            this.listen(swatch, "pointerdown", event => {
                if (event.button === 0) this.paletteDrag = { index, x: event.clientX, y: event.clientY, region };
            });
            palette.append(swatch);
        });
        if (region.palette.length < 5) this.button(this.t.add, () => {
            region.palette.push("#ffffff");
            this.commit();
            this.renderPanel();
        }, palette);
        this.panel.append(palette);
        this.layout();
    }

    clearCompletions() {
        for (const completion of this.inputCompletions) completion.destroy();
        this.inputCompletions.clear();
    }

    setRegionListOpen(open) {
        if (!this.regionList) return;
        cancelAnimationFrame(this.regionListFrame);
        const list = this.regionList;
        if (open) {
            list.hidden = false;
            list.showPopover();
            const trackPosition = () => {
                if (this.regionList !== list || !list.matches(":popover-open") || !this.root.isConnected) return;
                this.positionRegionList();
                this.regionListFrame = requestAnimationFrame(trackPosition);
            };
            trackPosition();
        } else {
            if (list.matches(":popover-open")) list.hidePopover();
            list.hidden = true;
        }
        this.regionTrigger.setAttribute("aria-expanded", String(open));
        this.selector.classList.toggle("cb-open", open);
    }

    positionRegionList() {
        const trigger = this.regionTrigger;
        const list = this.regionList;
        const rect = trigger.getBoundingClientRect();
        const scale = rect.width / (trigger.offsetWidth || 1);
        list.style.width = `${rect.width / scale}px`;
        list.style.transformOrigin = "top left";
        list.style.transform = `scale(${scale})`;
        const height = list.offsetHeight * scale;
        const top = rect.bottom + height <= window.innerHeight - 8
            ? rect.bottom : Math.max(8, rect.top - height);
        list.style.left = `${rect.left}px`;
        list.style.top = `${top}px`;
    }

    movePalette(event) {
        const drag = this.paletteDrag;
        if (!drag) return;
        if (!(event.buttons & 1)) { this.paletteDrag = null; return; }
        if (Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 4) return;
        this.lastPaletteDrag = Date.now();
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".cb-swatch");
        if (!target || !this.panel.contains(target)) return;
        const other = Number(target.dataset.index);
        if (other === drag.index) return;
        const [color] = drag.region.palette.splice(drag.index, 1);
        drag.region.palette.splice(other, 0, color);
        this.paletteDrag = null;
        this.commit(); this.renderPanel();
    }

    removeActive() {
        if (this.active < 0 || !this.regions[this.active]) return;
        this.regions.splice(this.active, 1);
        this.active = Math.min(this.active, this.regions.length - 1);
        this.commit();
        this.renderPanel();
    }

    point(event) {
        const rect = this.canvas.getBoundingClientRect();
        return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
    }

    hit(point) {
        const rect = this.canvas.getBoundingClientRect();
        return boxesAt(this.regions, point.x, point.y, 7, rect.width, rect.height, this.active)[0];
    }

    gridSpec() {
        const { width, height } = this.dimensions();
        // Same 32px grid / 64-cell cap as the official useBoundingBoxes.ts.
        return { fx: Math.max(32, Math.ceil(width / 64)) / width, fy: Math.max(32, Math.ceil(height / 64)) / height };
    }

    snapRegion(region, mode) {
        if (!this.grid) return region;
        const { fx, fy } = this.gridSpec();
        const snap = (value, step) => clamp(Math.round(value / step) * step);
        if (mode === "move") return { ...region, x: Math.min(snap(region.x, fx), 1 - region.w), y: Math.min(snap(region.y, fy), 1 - region.h) };
        const left = ["draw", "resize-l", "resize-tl", "resize-bl"].includes(mode);
        const right = ["draw", "resize-r", "resize-tr", "resize-br"].includes(mode);
        const top = ["draw", "resize-t", "resize-tl", "resize-tr"].includes(mode);
        const bottom = ["draw", "resize-b", "resize-bl", "resize-br"].includes(mode);
        const x1 = left ? snap(region.x, fx) : region.x;
        const y1 = top ? snap(region.y, fy) : region.y;
        const x2 = right ? snap(region.x + region.w, fx) : region.x + region.w;
        const y2 = bottom ? snap(region.y + region.h, fy) : region.y + region.h;
        return { ...region, x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
    }

    pointerDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        this.canvas.focus({ preventScroll: true });
        const startPoint = this.point(event);
        const hit = event.shiftKey ? null : this.hit(startPoint);
        const previous = copy(this.regions);
        let mode;
        if (hit) {
            this.active = hit.index;
            mode = hit.mode;
        } else {
            this.regions.push({ x: startPoint.x, y: startPoint.y, w: 0, h: 0, type: "obj", text: "", desc: "", palette: [] });
            this.active = this.regions.length - 1;
            mode = "draw";
        }
        this.drag = { pointerId: event.pointerId, startPoint, mode, start: copy(this.regions[this.active]), previous };
        this.canvas.setPointerCapture(event.pointerId);
        this.renderPanel();
        this.draw();
    }

    pointerMove(event) {
        const point = this.point(event);
        if (!this.drag) {
            const hit = this.hit(point);
            const cursor = { move: "move", "resize-tl": "nwse-resize", "resize-br": "nwse-resize", "resize-tr": "nesw-resize", "resize-bl": "nesw-resize", "resize-t": "ns-resize", "resize-b": "ns-resize", "resize-l": "ew-resize", "resize-r": "ew-resize" };
            this.canvas.style.cursor = cursor[hit?.mode] ?? "crosshair";
            return;
        }
        if (event.pointerId !== this.drag.pointerId) return;
        const { mode, start, startPoint } = this.drag;
        Object.assign(this.regions[this.active], this.snapRegion(applyDrag(mode, start, point.x - startPoint.x, point.y - startPoint.y), mode));
        this.draw();
    }

    pointerUp(event, cancel = false) {
        if (!this.drag || event.pointerId !== this.drag.pointerId) return;
        const id = this.drag.pointerId;
        this.finishDrag(cancel);
        if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    }

    finishDrag(cancel) {
        if (!this.drag) return;
        if (cancel) this.regions = this.drag.previous;
        else if (this.drag.mode === "draw") {
            const region = this.regions[this.active];
            if (region.w < .002 || region.h < .002) this.regions.splice(this.active, 1);
        }
        this.drag = null;
        this.active = Math.min(this.active, this.regions.length - 1);
        this.renderButtons();
        this.commit();
        this.renderPanel();
    }

    refreshResolution() {
        const scale = `${this.app.canvas?.ds?.scale}:${window.devicePixelRatio}`;
        if (scale === this.drawScale || this.drawFrame) return;
        this.drawFrame = requestAnimationFrame(() => { this.drawFrame = null; this.draw(); });
    }

    draw() {
        const style = getComputedStyle(this.canvas);
        const width = parseFloat(style.width);
        const height = parseFloat(style.height);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return;
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const pixelWidth = Math.max(1, Math.ceil(rect.width * dpr));
        const pixelHeight = Math.max(1, Math.ceil(rect.height * dpr));
        if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
        if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
        this.drawScale = `${this.app.canvas?.ds?.scale}:${dpr}`;
        const ctx = this.canvas.getContext("2d");
        ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
        ctx.clearRect(0, 0, width, height);
        if (this.grid) {
            ctx.fillStyle = "#ffffff18";
            const { fx, fy } = this.gridSpec();
            for (let x = fx * width; x < width; x += fx * width) for (let y = fy * height; y < height; y += fy * height) ctx.fillRect(x, y, 1, 1);
        }
        ctx.font = "11px monospace";
        const tags = tagRects(this.regions, width, height, (s) => ctx.measureText(s).width);
        this.regions.forEach((region, index) => {
            const x = region.x * width, y = region.y * height, w = region.w * width, h = region.h * height;
            const color = region.palette[0] || "#b4b4b8";
            ctx.fillStyle = index === this.active ? "#ffffff15" : "#ffffff07";
            ctx.fillRect(x, y, w, h);
            region.palette.slice(0, 5).forEach((swatch, i, colors) => {
                ctx.fillStyle = swatch;
                ctx.fillRect(x + i * w / colors.length, y, w / colors.length, Math.min(5, h));
            });
            ctx.strokeStyle = index === this.active ? "#ffffff" : color;
            ctx.lineWidth = index === this.active ? 2 : 1;
            ctx.strokeRect(x, y, w, h);
            const tag = tags[index];
            ctx.fillStyle = color;
            ctx.fillRect(tag.x, tag.y, tag.w, tag.h);
            ctx.fillStyle = "#111111";
            ctx.fillText(tag.tag, tag.x + 4, tag.y + 11);
            ctx.fillStyle = "#eeeeee";
            const text = region.type === "text" && region.text ? `“${region.text}” ${region.desc}` : region.desc;
            ctx.save();
            ctx.beginPath(); ctx.rect(x + 3, y + 17, Math.max(0, w - 6), Math.max(0, h - 20)); ctx.clip();
            let line = "", lineY = y + 29;
            for (const char of text) {
                if (char === "\n" || (line && ctx.measureText(line + char).width > w - 10)) {
                    ctx.fillText(line, x + 5, lineY); line = ""; lineY += 14;
                }
                if (char !== "\n") line += char;
                if (lineY > y + h) break;
            }
            ctx.fillText(line, x + 5, lineY);
            ctx.restore();
            if (index === this.active) {
                ctx.fillStyle = "#ffffff";
                for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) ctx.fillRect(hx - 3, hy - 3, 6, 6);
            }
        });
    }

    destroy() {
        this.clearCompletions();
        clearInterval(this.timer);
        cancelAnimationFrame(this.drawFrame);
        this.setRegionListOpen(false);
        this.loadGeneration++;
        this.abort.abort();
        this.closePalette?.();
        this.observer.disconnect();
        this.layoutObserver.disconnect();
        this.root.remove();
    }
}
