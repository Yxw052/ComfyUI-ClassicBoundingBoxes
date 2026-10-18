"""Compare this adapter with the official node on a running ComfyUI server.

Usage: python tests/backend_smoke.py --host http://127.0.0.1:8189
Runs only CPU image/text utility nodes. Requires Pillow, already part of ComfyUI.
"""
import argparse
import io
import json
import time
import urllib.parse
import urllib.request
import urllib.error
import uuid

from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="http://127.0.0.1:8188")
    args = parser.parse_args()
    host = args.host.rstrip("/")

    def request(path, data=None):
        body = None if data is None else json.dumps(data).encode("utf-8")
        req = urllib.request.Request(host + path, body, {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode("utf-8")) from error

    def execute(prompt):
        result = request("/prompt", {"prompt": prompt, "client_id": str(uuid.uuid4())})
        prompt_id = result["prompt_id"]
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            history = request("/history/" + prompt_id).get(prompt_id)
            if history:
                assert history["status"]["status_str"] == "success", history["status"]
                return history["outputs"]
            time.sleep(.15)
        raise TimeoutError("ComfyUI test prompt did not finish within 45 seconds")

    pixel_box = {"x": 128, "y": 64, "width": 256, "height": 192, "metadata": {
        "type": "text", "text": "你好 COMFY", "desc": "a matte paper sign", "palette": ["#f00", "#336699"]}}
    element = {"type": "text", "bbox": [125, 250, 750, 800], "text": "TEST", "desc": "a sign", "color_palette": ["#AABBCC"]}
    fixtures = [
        ("empty", [], None, []),
        ("edited text and palette", [pixel_box], None, []),
        ("pixel bboxes", [], [pixel_box], []),
        ("batched bboxes", [], [[pixel_box]], []),
        ("normalized elements", [], [element], []),
        ("JSON elements", [], json.dumps([element]), []),
        ("local edit takes priority", [pixel_box], [element], [{"x": 128, "y": 32, "width": 282, "height": 160, "metadata": {
            "type": "text", "text": "TEST", "desc": "a sign", "palette": ["#AABBCC"]}}]),
    ]
    definitions = request("/object_info")
    classic = definitions["YxwCreateBoundingBoxesClassic"]
    official = definitions["CreateBoundingBoxes"]
    assert classic["input"] == official["input"], "Input schema drifted"
    assert classic["output"] == official["output"]
    assert classic["output_name"] == official["output_name"]
    count = 0
    for label, state, incoming, last in fixtures:
        # ComfyUI distinguishes literal arrays from graph links with __value__.
        inputs = {"width": 512, "height": 256, "editor_state": {"__value__": state}, "last_incoming": {"__value__": last}}
        if incoming is not None:
            inputs["bboxes"] = {"__value__": incoming} if isinstance(incoming, list) else incoming
        prompt = {
            "1": {"class_type": "YxwCreateBoundingBoxesClassic", "inputs": inputs},
            "2": {"class_type": "CreateBoundingBoxes", "inputs": inputs},
            "3": {"class_type": "PreviewAny", "inputs": {"source": ["1", 1]}},
            "4": {"class_type": "PreviewAny", "inputs": {"source": ["2", 1]}},
            "5": {"class_type": "PreviewAny", "inputs": {"source": ["1", 2]}},
            "6": {"class_type": "PreviewAny", "inputs": {"source": ["2", 2]}},
            "7": {"class_type": "SaveImage", "inputs": {"images": ["1", 0], "filename_prefix": "classic_bbox_smoke/classic"}},
            "8": {"class_type": "SaveImage", "inputs": {"images": ["2", 0], "filename_prefix": "classic_bbox_smoke/official"}},
            "9": {"class_type": "Flux3LayoutPrompt", "inputs": {"prompt": "A test scene containing <obj_1>.", "element": ["1", 2]}},
            "10": {"class_type": "Flux3LayoutPrompt", "inputs": {"prompt": "A test scene containing <obj_1>.", "element": ["2", 2]}},
            "11": {"class_type": "PreviewAny", "inputs": {"source": ["9", 0]}},
            "12": {"class_type": "PreviewAny", "inputs": {"source": ["10", 0]}},
        }
        outputs = execute(prompt)
        for left, right in [("3", "4"), ("5", "6"), ("11", "12")]:
            assert outputs[left] == outputs[right], (label, left, outputs[left], outputs[right])
        images = []
        for output in ["7", "8"]:
            ref = outputs[output]["images"][0]
            with urllib.request.urlopen(host + "/view?" + urllib.parse.urlencode(ref), timeout=30) as response:
                image = Image.open(io.BytesIO(response.read())).convert("RGB")
                images.append((image.size, image.tobytes()))
        assert images[0] == images[1], (label, "preview pixels differ")
        if label == "local edit takes priority":
            assert "你好 COMFY" in json.dumps(outputs["5"], ensure_ascii=False), "local metadata was lost"
        count += 1
        print("PASS:", label, "(bboxes, elements, preview pixels, FLUX.3 prompt)")
    print(f"PASS: official schema parity and {count} live execution cases")


if __name__ == "__main__":
    main()
