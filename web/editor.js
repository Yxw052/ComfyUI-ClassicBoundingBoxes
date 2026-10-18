// SPDX-License-Identifier: GPL-3.0-or-later
// Classic DOM adapter. Geometry/conversion helpers are from ComfyUI_frontend.
import { applyDrag, boxesAt, fromBoundingBoxes, toBoundingBoxes, tagRects } from "./geometry.js";

const copy = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value) => Math.max(0, Math.min(1, value));
const zh = {
    grid: "网格", clear: "全部清除", draw: "绘制新框", region: "选择区域", text: "文字",
    desc: "描述", palette: "调色板", add: "+", remove: "删除", back: "下移", front: "上移", canvas: "边界框绘制画布",
    empty: "在画布空白处拖动即可画框；按住 Shift 可在已有框内画新框。",
    help: "拖动框体移动；拖动边缘或四角缩放。Delete 删除选中框。",
    background: "连接背景图即可预览；其他上游节点请先运行一次。",
    clearConfirm: "清除所有边界框？", failed: "背景预览加载失败，请运行节点以刷新。",
};
const en = {
    grid: "Grid", clear: "Clear all", draw: "Draw new", region: "Select region", text: "Text",
    desc: "Description", palette: "Palette", add: "+", remove: "Delete", back: "Send backward", front: "Bring forward", canvas: "Bounding box drawing canvas",
    empty: "Drag empty space to draw. Hold Shift to draw inside an existing box.",
    help: "Drag a box to move; drag an edge or corner to resize. Delete removes the selection.",
    background: "Connect a background image. Run once for other upstream nodes.",
    clearConfirm: "Clear all bounding boxes?", failed: "Could not load the background preview. Run the node to refresh it.",
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
        this.newMode = false;
        this.grid = node.properties?.classicBBoxGrid !== false;
        this.background = null;
        this.backgroundURL = "";
        this.loadGeneration = 0;
        this.abort = new AbortController();
        this.root = element("div", "classic-bbox");
        this.root.dataset.testid = "classic-bbox-editor";
        this.build();
        this.observer = new ResizeObserver(() => this.draw());
        this.observer.observe(this.stage);
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
        // Keep widget events out of LiteGraph's drag, zoom and hotkey handlers.
        for (const name of ["pointerdown", "pointermove", "pointerup", "click", "dblclick", "contextmenu", "keydown", "keyup"]) {
            this.listen(this.root, name, (event) => event.stopPropagation());
        }
        this.listen(this.root, "wheel", (event) => {
            // Textareas retain their native scrolling; otherwise scroll the editor.
            if (!(event.target instanceof HTMLTextAreaElement)) {
                this.root.scrollTop += event.deltaY;
                event.preventDefault();
            }
            event.stopPropagation();
        }, { passive: false });

        const toolbar = element("div", "cb-toolbar");
        this.gridButton = this.button(this.t.grid, () => {
            this.grid = !this.grid;
            this.node.properties.classicBBoxGrid = this.grid;
            this.renderButtons();
            this.changed();
        }, toolbar);
        this.drawButton = this.button(this.t.draw, () => {
            this.newMode = !this.newMode;
            this.renderButtons();
        }, toolbar);
        this.button(this.t.clear, () => {
            if (!this.regions.length || !window.confirm(this.t.clearConfirm)) return;
            this.regions = [];
            this.active = -1;
            this.commit();
            this.renderPanel();
        }, toolbar).classList.add("cb-clear");

        this.status = element("p", "cb-status", this.t.background);
        this.stage = element("div", "cb-stage");
        this.canvas = element("canvas");
        this.canvas.tabIndex = 0;
        this.canvas.setAttribute("aria-label", this.t.canvas);
        this.stage.append(this.canvas);
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
        this.hint = element("p", "cb-hint", this.t.empty);
        this.root.append(toolbar, this.status, this.stage, this.panel, this.hint);
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
        this.stage.style.aspectRatio = `${width} / ${height}`;
        this.renderButtons();
        this.renderPanel();
        const ref = this.node.properties?.classicBBoxBackground;
        if (ref) this.loadBackground(this.imageURL(ref));
        this.checkSources();
        requestAnimationFrame(() => this.draw());
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
        this.stage.style.aspectRatio = `${width} / ${height}`;
        this.seenDimensions = `${width}:${height}`;
        if (before.width !== width || before.height !== height) this.commit();
        this.status.textContent = `${width} × ${height}`;
        this.draw();
    }

    checkSources() {
        if (!this.root.isConnected || this.drag) return;
        const locale = this.app.ui?.settings?.getSettingValue?.("Comfy.Locale") ?? navigator.language;
        const nextTranslations = String(locale).toLowerCase().startsWith("zh") ? zh : en;
        if (nextTranslations !== this.t) {
            this.t = nextTranslations;
            this.abort.abort();
            this.abort = new AbortController();
            this.observer.disconnect();
            this.root.replaceChildren();
            this.build();
            this.observer.observe(this.stage);
            this.renderPanel();
            const dims = this.dimensions();
            this.stage.style.aspectRatio = `${dims.width} / ${dims.height}`;
            this.status.textContent = `${dims.width} × ${dims.height}`;
            this.draw();
        }
        const { width, height } = this.dimensions();
        const key = `${width}:${height}`;
        if (key !== this.seenDimensions) {
            // Official region geometry is normalized; resolution changes scale boxes.
            this.seenDimensions = key;
            this.stage.style.aspectRatio = `${width} / ${height}`;
            this.commit();
        } else if (JSON.stringify(this.stateWidget.value) !== this.seenValue) this.restore();

        const slot = this.node.inputs?.findIndex((input) => input.name === "background");
        const upstream = slot >= 0 ? this.node.getInputNode(slot) : null;
        if (!upstream) {
            if (this.hadBackgroundConnection) {
                this.hadBackgroundConnection = false;
                this.background = null;
                this.backgroundURL = "";
                this.loadGeneration++;
                delete this.node.properties.classicBBoxBackground;
                this.status.textContent = `${width} × ${height}`;
                this.draw();
            }
            return;
        }
        this.hadBackgroundConnection = true;
        const sourceImage = upstream.imgs?.[upstream.imageIndex ?? 0] ?? upstream.imgs?.[0];
        if (sourceImage?.src) {
            this.loadBackground(sourceImage.src);
            return;
        }
        const image = upstream.widgets?.find((w) => w.name === "image")?.value;
        if (upstream.comfyClass === "LoadImage" && typeof image === "string" && image) {
            const match = /\s\[(input|output|temp)\]$/.exec(image);
            const filename = match ? image.slice(0, match.index) : image;
            this.loadBackground(this.imageURL({ filename, type: match?.[1] ?? "input", subfolder: "" }));
        }
    }

    imageURL(ref) {
        const params = new URLSearchParams({ filename: ref.filename, type: ref.type ?? "input", subfolder: ref.subfolder ?? "" });
        return this.api.apiURL(`/view?${params}`);
    }

    loadBackground(url) {
        if (url) {
            const params = new URL(url, window.location.href).searchParams;
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
            this.setDimensions(image.naturalWidth, image.naturalHeight);
        };
        image.onerror = () => {
            if (generation !== this.loadGeneration) return;
            this.background = null;
            this.status.textContent = this.t.failed;
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
        this.drawButton.setAttribute("aria-pressed", String(this.newMode));
    }

    renderPanel() {
        this.panel.replaceChildren();
        this.panel.hidden = !this.regions.length;
        this.hint.textContent = this.regions.length ? this.t.help : this.t.empty;
        if (!this.regions.length) return;
        const select = element("select");
        select.setAttribute("aria-label", this.t.region);
        this.regions.forEach((region, index) => {
            const label = `${String(index + 1).padStart(2, "0")} · ${region.type} · ${region.desc || region.text || "…"}`;
            const option = element("option", "", label.slice(0, 100));
            option.value = String(index);
            select.append(option);
        });
        if (this.active < 0) this.active = 0;
        select.value = String(this.active);
        this.listen(select, "change", () => {
            this.active = Number(select.value);
            this.renderPanel();
            this.draw();
        });
        this.panel.append(select);
        const region = this.regions[this.active];
        if (!region) return;
        const tabs = element("div", "cb-tabs");
        for (const type of ["obj", "text"]) {
            const button = this.button(type, () => {
                region.type = type;
                this.commit();
                this.renderPanel();
            }, tabs);
            button.setAttribute("aria-pressed", String(region.type === type));
        }
        this.panel.append(tabs);
        const field = (name, label) => {
            const wrapper = element("label", "cb-label", label);
            const input = element("textarea");
            input.value = region[name] ?? "";
            input.setAttribute("aria-label", label);
            this.listen(input, "input", () => { region[name] = input.value; this.commit(); });
            wrapper.append(input);
            this.panel.append(wrapper);
        };
        if (region.type === "text") field("text", this.t.text);
        field("desc", this.t.desc);
        const palette = element("div", "cb-palette");
        palette.append(element("span", "", this.t.palette));
        region.palette.forEach((color, index) => {
            const swatch = element("span", "cb-swatch");
            const input = element("input");
            input.type = "color";
            input.value = color.slice(0, 7);
            input.setAttribute("aria-label", `${this.t.palette} ${index + 1}`);
            this.listen(input, "input", () => { region.palette[index] = input.value; this.commit(); });
            swatch.append(input);
            this.button("×", () => { region.palette.splice(index, 1); this.commit(); this.renderPanel(); }, swatch)
                .setAttribute("aria-label", `${this.t.remove} ${this.t.palette} ${index + 1}`);
            palette.append(swatch);
        });
        if (region.palette.length < 5) this.button(this.t.add, () => {
            region.palette.push("#8c8c8c");
            this.commit();
            this.renderPanel();
        }, palette);
        this.panel.append(palette);
        const actions = element("div", "cb-actions");
        actions.style.marginTop = "8px";
        this.button(this.t.back, () => this.reorder(-1), actions).disabled = this.active === 0;
        this.button(this.t.front, () => this.reorder(1), actions).disabled = this.active === this.regions.length - 1;
        this.button(this.t.remove, () => this.removeActive(), actions);
        this.panel.append(actions);
    }

    reorder(delta) {
        const target = this.active + delta;
        if (target < 0 || target >= this.regions.length) return;
        [this.regions[this.active], this.regions[target]] = [this.regions[target], this.regions[this.active]];
        this.active = target;
        this.commit();
        this.renderPanel();
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
        const hit = this.newMode || event.shiftKey ? null : this.hit(startPoint);
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
            const hit = this.newMode ? null : this.hit(point);
            const cursor = { move: "move", "resize-tl": "nwse-resize", "resize-br": "nwse-resize", "resize-tr": "nesw-resize", "resize-bl": "nesw-resize", "resize-t": "ns-resize", "resize-b": "ns-resize", "resize-l": "ew-resize", "resize-r": "ew-resize" };
            this.canvas.style.cursor = cursor[hit?.mode] ?? "crosshair";
            return;
        }
        if (event.pointerId !== this.drag.pointerId) return;
        const { mode, start, startPoint } = this.drag;
        this.regions[this.active] = this.snapRegion(applyDrag(mode, start, point.x - startPoint.x, point.y - startPoint.y), mode);
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
        this.newMode = false;
        this.renderButtons();
        this.commit();
        this.renderPanel();
    }

    draw() {
        const width = this.stage.clientWidth;
        const height = this.stage.clientHeight;
        if (width < 1 || height < 1) return;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        const ctx = this.canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "#171719";
        ctx.fillRect(0, 0, width, height);
        if (this.background) {
            ctx.globalAlpha = .5;
            ctx.drawImage(this.background, 0, 0, width, height);
            ctx.globalAlpha = 1;
        }
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
        clearInterval(this.timer);
        this.loadGeneration++;
        this.abort.abort();
        this.observer.disconnect();
        this.root.remove();
    }
}
