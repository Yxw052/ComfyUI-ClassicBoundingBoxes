"""Keep the official backend; adapt only the frontend widget rendering.

Requires a ComfyUI installation containing comfy_extras.nodes_bounding_boxes.
No fork of the official coordinate, preview, or element-generation code is kept.
"""

from comfy_extras.nodes_bounding_boxes import CreateBoundingBoxes


class CreateBoundingBoxesClassic(CreateBoundingBoxes):
    @classmethod
    def define_schema(cls):
        schema = super().define_schema()
        schema.node_id = "YxwCreateBoundingBoxesClassic"
        schema.display_name = "Create Bounding Boxes (Classic)"
        schema.category = "utilities/bounding boxes"
        schema.description = (
            "The official Create Bounding Boxes backend with an editor for the "
            "classic LiteGraph UI. Connect the same preview, bboxes and elements outputs."
        )
        schema.search_aliases = ["classic bbox", "bounding boxes", "创建边界框", "旧界面"]
        schema.is_experimental = False
        return schema
