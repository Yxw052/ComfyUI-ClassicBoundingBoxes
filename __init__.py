"""Classic UI adapter for ComfyUI's official Create Bounding Boxes node."""

from comfy_api.latest import ComfyExtension, io

from .classic_node import CreateBoundingBoxesClassic

WEB_DIRECTORY = "./web"


class ClassicBoundingBoxesExtension(ComfyExtension):
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [CreateBoundingBoxesClassic]


async def comfy_entrypoint() -> ClassicBoundingBoxesExtension:
    return ClassicBoundingBoxesExtension()
