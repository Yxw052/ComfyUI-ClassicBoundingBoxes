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
- Deleting only the selected region. Dedicated vertical-movement buttons were removed in 0.3.0; boxes remain movable by dragging.
- Resizing the node's outer bottom-right corner: width increased from 480 to approximately 636, while the editor's displayed width increased from 414 to approximately 554 screen pixels at 90% zoom.
- Workflow serialize/configure round trips retain exactly four official widget values, with no helper-widget value or index shift.
- Full browser refresh restores the saved boxes, text and palette.
- Load Image background preview and synchronization to a 1024×768 image.
- Chinese node title, input/output labels and widget labels loaded through the official `/i18n` endpoint; English locale uses the corresponding English UI.

The screenshot in this repository is from the actual classic ComfyUI canvas, not a mockup.

No inference-quality claim is made: this node edits layout data and inherits the official backend. Very old ComfyUI versions, every third-party pack combination and other browsers are outside this validation.

## Compact editor revision (0.2.0)

Real browser checks additionally passed for white-by-default swatch creation; Hex/RGB input; dragging both the saturation/value field and hue strip; palette swatch reordering; right-click swatch deletion; direct canvas drawing without a draw tool button; and another save/reload round trip. The custom popover replaces the native OS color input and contains no delete cross.

At a 320px node width, the editor's inner width measured 300px. A selected text region containing 128 Chinese characters had a text field client height and scroll height of 132px each. The root client height equalled its scroll height (610px), and the full panel remained inside the node. The compact image canvas preserves the source aspect ratio and is capped at 300×260 CSS pixels; it shrinks further when space is limited.

The resolution status row, draw button and instructional text elements were absent. A real up-button click changed only the selected box's Y coordinate by -32 canvas pixels; the other box remained unchanged, and down reversed the movement.

A connected 896×1152 portrait test image was displayed in a 168×217 canvas, preserving its aspect ratio within pixel rounding. The root's scroll height equalled its client height, and the image was shown in full rather than clipped behind a scrollbar.

## Image and interaction revision (0.3.0)

The background is now a separate original-file image element, rather than an image painted into a small canvas and enlarged with the graph. Same-origin ComfyUI `/view` URLs have thumbnail `preview` and channel overrides removed. Load Image reads its selected original file before considering upstream preview images. The transparent overlay uses actual on-screen dimensions multiplied by device pixel ratio and redraws when graph zoom changes.

At device pixel ratio 1, real browser measurements were:

| Graph zoom | Overlay width on screen | Bitmap width |
| --- | ---: | ---: |
| 60% | 178.80px | 179px |
| 100% | 298px | 298px |
| 123% | 366.54px | 367px |
| 250% | 745px | 745px |

The background element decoded the original 1024×768 test file with no `preview` query. These checks establish removal of the intermediate low-resolution bitmap; they do not claim recovery of detail absent from the source image.

Real mouse input verified four successive object/text switches, with the selected type updated before the first pointer release. The type buttons keep their DOM elements during field reflow, and the resulting Chinese text survives region selection and workflow save/reload. Toolbar order is Grid / Delete / Clear all, with no up/down buttons. Deletion affects only the selected region. A dialog listener observed zero dialogs when clearing; editor state was empty immediately, and new regions could be drawn afterward.

The native region select was replaced by an inline, consistently styled listbox supporting pointer selection and keyboard navigation. Seven expanded region options fit without internal overflow (root client height and scroll height both 633px). At 320px node width, the inner width was 300px; the 128-character Chinese text field measured 132px for both client and scroll height.

The default Chinese title was verified as `创建边界框（Nodes1.0）`. Loading a workflow with the previous automatic title upgrades it; a user-written custom title remains intact. A full refresh retained both regions and the original background; switching Chinese → English → Chinese kept the image decoded at 1024×768. Keyboard selection through the inline list and Hex palette editing also passed. The seven official/backend execution comparisons passed again after the schema rename.

## Floating menu and graph wheel input (0.3.1)

The inline expander was replaced by a styled top-layer popover, outside layout flow. It follows the trigger during graph movement/zoom and escapes widget clipping. Seven options were opened and closed at 80%, 100% and 123% graph zoom. Exact before/open/closed comparisons of the image rectangle, type-tab rectangle, field rectangle, node dimensions and root scroll height were identical. At 100%, the image remained 300×225 screen pixels and the node remained 440×800. Menu width matched the trigger at all three scales. Selection, Escape dismissal and single-press text editing passed. See [the floating-menu screenshot](region-list-zh.png).

Real wheel input over the image canvas, text field, palette row and lower empty area each changed graph zoom from 1 to 1.1 and back to 1. The graph coordinate under the pointer was preserved within 0.04 canvas pixels. The adapter forwards wheel deltas, coordinates and modifiers to the real ComfyUI canvas; it does not implement its own zoom scale or limits, so user-configured pan/zoom behavior remains authoritative.

## Stable image size during type changes (0.3.2)

The image no longer uses the height left over by the editing panel. Its size depends only on node width and source aspect ratio, capped at 300×260 CSS pixels. The DOM widget's minimum height includes that full image height. Additional fields or wrapped text increase the node height instead of reducing image space; repeated layout passes do not repeatedly request the same height deficit.

Real pointer input performed five alternating text/object switches for each of a 1024×768 landscape image, an 896×1152 portrait image, and the portrait in a 320px-wide node. The landscape stayed exactly 300×225 screen pixels; both portrait cases stayed 202.21875×260. Long Chinese text also kept those image dimensions. In every measurement, the editor's client and scroll heights matched, all text fields fit, and the complete panel stayed within the node. The first landscape text switch increased node height from 612 to 693, then all subsequent switches kept that height; longer text increased it to 733. Workflow serialization/reload retained editor data and image size.
