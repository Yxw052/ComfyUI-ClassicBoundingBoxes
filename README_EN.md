# ComfyUI Classic Bounding Boxes

[简体中文](README.md)

The official **Create Bounding Boxes** backend with an editor for the **classic LiteGraph UI**. Resize the node horizontally or vertically; the canvas follows the display width.

![Classic editor](docs/classic-editor-zh.png)

## Installation

From `ComfyUI/custom_nodes`:

```bash
git clone https://github.com/Yxw052/ComfyUI-ClassicBoundingBoxes.git
```

Restart ComfyUI and refresh the browser. No extra Python dependencies or frontend build is needed.

Requires ComfyUI's `comfy_extras.nodes_bounding_boxes` and the V3 API. Classic UI support does **not** imply compatibility with old ComfyUI backends. Tested on ComfyUI **0.41.3**, frontend **1.55.17**, Chrome/Chromium.

## Usage

Disable Nodes 2.0 and add **Create Bounding Boxes (Nodes1.0)**. Replace the official node in your graph and reconnect its inputs and outputs. The official node itself remains available.

- Connect Load Image to `background` for an immediate preview; run other upstream image nodes once.
- Drag empty space to draw. Hold Shift to draw inside another region.
- Move a box by dragging its body. Resize it from its edges or corners.
- Edit object/text type, text, description and up to five palette colors below the canvas.
- Select overlapping regions using the floating region menu. Opening it keeps the image size and all underlying controls in place. Object/text tabs switch on the first pointer press. The toolbar contains **Grid, Delete, Clear all**; clearing executes immediately, without a confirmation dialog.
- Wheel input over the image, text fields, palette and lower empty area is forwarded to ComfyUI's graph canvas, preserving its configured zoom/pan behavior and pointer anchor.
- Click a palette swatch to edit, right-click to remove it, and drag swatches to reorder colors. The plus button adds white. The popover matches the official square color field, hue strip, and Hex/RGB inputs.
- Resize the node from its outer bottom-right corner. Canvas resolution is independent of display size.

The grid follows the official 32-pixel snapping rule, with the official large-canvas cell cap. Saved workflows retain the official `editor_state` and `last_incoming` values. English and Chinese labels follow the ComfyUI locale. Unicode metadata is preserved; font rendering in the output preview remains the responsibility of the official backend.

The original background image is fitted to a compact view with its aspect ratio preserved. Its size depends on node width and source aspect ratio, so object/text switching and long text never shrink the image; the node grows downward when more space is needed. Its image layer is composited directly by the browser; the separate box overlay follows graph zoom and device pixel ratio instead of enlarging a small bitmap. No internal scrollbar, native OS region dropdown or color picker, swatch delete cross, extra resolution readout, draw button or instructional footer is used. Text fields grow to show wrapped content, including after the node is narrowed.

## Object-reference completion

The classic editor's description/text fields and a connected official **FLUX.3 Layout Prompt** prompt offer `<obj_n>` completion. Type `<`, `>`, `o`, `b`, `j`, `_`, a number, or a partial reference to filter live box IDs. All regions, including text regions, follow the official element order. Click a candidate or use Up/Down and Enter/Tab; Escape dismisses it. Only the fragment at the caret is replaced; surrounding text and native undo are preserved. IME composition is not interrupted. The popup floats near the caret without reflowing the image or controls.

Layout Prompt candidates come from its connected `element` source, optionally through Reroute, rather than unrelated nodes. Adding/removing regions updates candidates. Existing references in saved text are not automatically renumbered. See [the real UI screenshot](docs/object-completion-zh.png).

## Compatibility and implementation

`CreateBoundingBoxesClassic` inherits the official node and changes only its schema identity and presentation. It **does not override `execute`**. Outputs remain `IMAGE`, `BOUNDING_BOX`, `ARRAY`, in the original order. The frontend geometry and conversion helpers are adapted from ComfyUI_frontend v1.55.17.

Open [the example workflow](example_workflows/classic_bounding_boxes.json) to inspect a FLUX.3 layout prompt without loading a model. See [validation details](docs/VALIDATION.md) for the live browser and seven-case backend comparison. Other historical versions, third-party node combinations and browsers have not all been tested.

```bash
npm test
npm run check
python tests/backend_smoke.py --host http://127.0.0.1:8189
```

The backend smoke test requires a running ComfyUI instance with this pack loaded and writes previews under that instance's `classic_bbox_smoke/` output subfolder.

GPL-3.0-or-later. See [NOTICE.md](NOTICE.md). Community adapter; not an official Comfy Org project.
