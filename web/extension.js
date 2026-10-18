// SPDX-License-Identifier: GPL-3.0-or-later
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { ClassicBoundingBoxesEditor } from "./editor.js";
import { objectTokenOptions } from "./object-tokens.js";
import { attachObjectCompletion } from "./object-completion.js";

const NODE_ID = "YxwCreateBoundingBoxesClassic";
const editors = new WeakMap();
const instances = new Set();
const layoutCompletions = new WeakMap();

function layoutObjectOptions(node) {
    const slot = node.inputs?.findIndex(input => input.name === "element");
    let source = slot >= 0 ? node.getInputNode(slot) : null;
    const visited = new Set();
    while (source && !visited.has(source)) {
        visited.add(source);
        if ([NODE_ID, "CreateBoundingBoxes"].includes(source.comfyClass)) {
            return objectTokenOptions(editors.get(source)?.regions ?? source.widgets?.find(widget => widget.name === "editor_state")?.value);
        }
        if (source.type !== "Reroute" && source.comfyClass !== "Reroute") break;
        source = source.getInputNode(0);
    }
    return [];
}

function attachLayoutCompletion(node) {
    if (node.comfyClass !== "Flux3LayoutPrompt" || layoutCompletions.has(node)) return;
    const widget = node.widgets?.find(widget => widget.name === "prompt");
    const input = widget?.element instanceof HTMLTextAreaElement ? widget.element
        : widget?.element?.querySelector?.("textarea") ?? widget?.inputEl;
    if (!(input instanceof HTMLTextAreaElement)) return;
    const locale = app.ui?.settings?.getSettingValue?.("Comfy.Locale") ?? navigator.language;
    const completion = attachObjectCompletion(input, () => layoutObjectOptions(node), { chinese: String(locale).toLowerCase().startsWith("zh") });
    layoutCompletions.set(node, completion);
    const oldRemoved = node.onRemoved;
    node.onRemoved = function () {
        completion.destroy(); layoutCompletions.delete(this);
        oldRemoved?.apply(this, arguments);
    };
}

function refreshLabels(node) {
    const input = node.inputs?.find(input => input.name === "bboxes");
    if (input) input.localized_name = "bboxes";
    // Upgrade only previous automatic titles; keep user-written titles intact.
    if (!["创建边界框（旧界面）", "Create Bounding Boxes (Classic)"].includes(node.title)) return;
    const locale = app.ui?.settings?.getSettingValue?.("Comfy.Locale") ?? navigator.language;
    node.title = String(locale).toLowerCase().startsWith("zh")
        ? "创建边界框（Nodes1.0）" : "Create Bounding Boxes (Nodes1.0)";
}

function hideWidget(widget) {
    if (!widget) return;
    widget.hidden = true;
    widget.options ??= {};
    widget.options.hidden = true;
    widget.computeSize = () => [0, -4];
    for (const element of [widget.element, widget.inputEl]) {
        if (element?.style) element.style.display = "none";
    }
}

function attach(node) {
    if (node.comfyClass !== NODE_ID || editors.has(node)) return;
    refreshLabels(node);
    const state = node.widgets?.find((w) => w.name === "editor_state");
    const incoming = node.widgets?.find((w) => w.name === "last_incoming");
    if (!state || !incoming) throw new Error("Classic Bounding Boxes: official widgets are missing.");
    hideWidget(state);
    hideWidget(incoming);

    const editor = new ClassicBoundingBoxesEditor(node, state, incoming, app, api);
    editors.set(node, editor);
    instances.add(editor);
    const oldDraw = node.onDrawForeground;
    node.onDrawForeground = function () {
        oldDraw?.apply(this, arguments);
        editor.refreshResolution();
    };
    // This is a view onto the original widgets, never an extra serialized value.
    // Keep it last: older frontends restore widgets_values by compacting indices.
    const domWidget = node.addDOMWidget("classic_bbox_editor", "classic_bbox_editor", editor.root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => editor.minimumHeight(),
        getHeight: () => 450,
        getValue: () => "",
    });
    domWidget.serialize = false;
    domWidget.options.hideInPanel = true;
    const oldExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        oldExecuted?.apply(this, arguments);
        editor.onExecuted(output);
    };
    const oldRemoved = node.onRemoved;
    node.onRemoved = function () {
        editor.destroy();
        instances.delete(editor);
        oldRemoved?.apply(this, arguments);
    };
    state.beforeQueued = () => editor.beforeQueued();
    node.setSize([Math.max(node.size[0], 360), Math.max(node.size[1], 600)]);
}

app.registerExtension({
    name: "Yxw.ClassicBoundingBoxes",
    async setup() {
        if (!document.getElementById("classic-bbox-styles")) {
            const link = document.createElement("link");
            link.id = "classic-bbox-styles";
            link.rel = "stylesheet";
            link.href = new URL("./styles.css", import.meta.url).href;
            document.head.append(link);
        }
        // Output hooks are not fired when a cached graph is reloaded. Restore
        // preview references after the graph has finished configuring instead.
    },
    nodeCreated(node) { attach(node); attachLayoutCompletion(node); },
    loadedGraphNode(node) {
        attachLayoutCompletion(node);
        if (editors.has(node)) { refreshLabels(node); editors.get(node).restore(); }
    },
    afterConfigureGraph() {
        for (const editor of instances) { refreshLabels(editor.node); editor.restore(); }
    },
});
