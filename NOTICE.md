# Upstream code and references

This is a compatibility adapter, not a replacement implementation of the ComfyUI backend.

- `classic_node.py` subclasses `CreateBoundingBoxes` from the installed ComfyUI `comfy_extras/nodes_bounding_boxes.py`. Its `execute` method, coordinate parsing, preview rendering and element output are inherited unchanged. Source: https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_bounding_boxes.py
- `web/geometry.js` contains the original geometry and conversion functions from `Comfy-Org/ComfyUI_frontend`, tag `v1.55.17`, `src/composables/boundingBoxes/boundingBoxesUtil.ts`. Only TypeScript annotations and interfaces were removed with Node.js `stripTypeScriptTypes`. Source: https://github.com/Comfy-Org/ComfyUI_frontend/blob/v1.55.17/src/composables/boundingBoxes/boundingBoxesUtil.ts
- Grid snapping in `web/editor.js` is adapted from the same tag's `src/composables/boundingBoxes/useBoundingBoxes.ts`. The classic DOM event, editor and lifecycle integration is adapter code.
- Object-reference completion is adapter code. Numbering follows `Flux3LayoutPrompt.execute` in the installed ComfyUI `comfy_extras/nodes_flux.py`: every element receives `obj_{index + 1}`, including text regions. Source: https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_flux.py
- `web/color-utils.js` contains selected unchanged conversion functions from the same tag's `src/utils/colorUtil.ts`, with TypeScript types removed. `web/color-picker.js` adapts the layout and interaction of `src/components/ui/color-picker/ColorPickerPanel.vue`, `ColorPickerSaturationValue.vue`, and `ColorPickerSlider.vue` to classic DOM rendering. Palette swatch behavior follows `usePaletteSwatchRow.ts`.

ComfyUI and ComfyUI_frontend upstream code are distributed under GPL-3.0. This adapter is distributed under GPL-3.0-or-later; see LICENSE.

Development references consulted:

- ComfyUI official custom-node JavaScript hooks and i18n documentation: https://docs.comfy.org/custom-nodes/js/javascript_hooks and https://docs.comfy.org/custom-nodes/i18n
- `comfyui-node-authoring` skill by laurigates: https://github.com/laurigates/claude-plugins/blob/main/comfyui-plugin/skills/comfyui-node-authoring/SKILL.md
- `comfyui-node-basics`, `comfyui-node-frontend`, `comfyui-node-packaging` skills by jtydhr88: https://github.com/jtydhr88/comfyui-custom-node-skills/tree/master/plugins/comfyui-custom-nodes/skills

No code from ComfyUI-Nodes2Classic is bundled.
