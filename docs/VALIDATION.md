# Validation

Test date: 2026-10-18. Windows, ComfyUI 0.41.3, comfyui-frontend-package 1.55.17, Chromium. Testing used a separate CPU-only server on port 8189, separate user/input/output/temp directories, and only this custom pack enabled.

## Automated geometry checks

`npm test` checks pixel/normalized round trips including Unicode text and palette metadata, all four resize corners, reverse-direction drawing, canvas bounds, edge/corner hit-testing and overlapping region selection.

## Real ComfyUI backend comparison

`tests/backend_smoke.py` submits paired prompts to a real server. It asserts that this node and the official `CreateBoundingBoxes` expose identical input schemas, output types and output names. Seven fixtures compare:

1. Empty editor.
2. Edited text, Unicode and palette values.
3. Incoming pixel bounding boxes.
4. Batched incoming boxes.
5. Normalized element arrays.
6. JSON element strings.
7. An unchanged upstream value with newer local edits.

For every fixture, the test compares the actual `BOUNDING_BOX` output through PreviewAny, the actual `ARRAY` elements, RGB preview pixels loaded from SaveImage outputs, and the downstream official FLUX.3 Layout Prompt output. All seven fixtures passed. Literal array inputs use ComfyUI's `{"__value__": [...]}` API representation.

## Real browser checks

With `Comfy.VueNodes.Enabled = false`, real mouse input verified:

- Drawing and moving a region without moving its containing node.
- Corner resizing of a region, official 32px grid snapping, and drawing inside an existing region.
- Object/text switching, Chinese text and description editing, and palette changes.
- Layer reordering and deleting only the selected region.
- Resizing the node's outer bottom-right corner: width increased from 480 to approximately 636, while the editor's displayed width increased from 414 to approximately 554 screen pixels at 90% zoom.
- Workflow serialize/configure round trips retain exactly four official widget values, with no helper-widget value or index shift.
- Full browser refresh restores the saved boxes, text and palette.
- Load Image background preview and synchronization to a 1024×768 image.
- Chinese node title, input/output labels and widget labels loaded through the official `/i18n` endpoint; English locale uses the corresponding English UI.

The screenshot in this repository is from the actual classic ComfyUI canvas, not a mockup.

No inference-quality claim is made: this node edits layout data and inherits the official backend. Very old ComfyUI versions, every third-party pack combination and other browsers are outside this validation.
