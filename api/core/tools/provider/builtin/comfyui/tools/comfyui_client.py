import base64
import io
import json
import random
import uuid

import httpx
from websocket import WebSocket
from yarl import URL

from core.file.file_manager import _get_encoded_string
from core.file.models import File


class ComfyUiClient:
    def __init__(self, base_url: str):
        self.base_url = URL(base_url)

    def get_history(self, prompt_id: str) -> dict:
        res = httpx.get(str(self.base_url / "history"), params={"prompt_id": prompt_id})
        history = res.json()[prompt_id]
        return history

    def get_image(self, filename: str, subfolder: str, folder_type: str) -> bytes:
        response = httpx.get(
            str(self.base_url / "view"),
            params={"filename": filename, "subfolder": subfolder, "type": folder_type},
        )
        return response.content

    def upload_image(self, image_file: File) -> dict:
        image_content = base64.b64decode(_get_encoded_string(image_file))
        file = io.BytesIO(image_content)
        files = {"image": (image_file.filename, file, image_file.mime_type), "overwrite": "true"}
        res = httpx.post(str(self.base_url / "upload/image"), files=files)
        return res.json()

    def queue_prompt(self, client_id: str, prompt: dict) -> str:
        res = httpx.post(str(self.base_url / "prompt"), json={"client_id": client_id, "prompt": prompt})
        prompt_id = res.json()["prompt_id"]
        return prompt_id

    def open_websocket_connection(self) -> tuple[WebSocket, str]:
        client_id = str(uuid.uuid4())
        ws = WebSocket()
        ws_address = f"ws://{self.base_url.authority}/ws?clientId={client_id}"
        ws.connect(ws_address)
        return ws, client_id

    def set_prompt(
        self, origin_prompt: dict, positive_prompt: str, negative_prompt: str = "", image_name: str = ""
    ) -> dict:
        """
        find the first KSampler, then can find the prompt node through it.
        """
        prompt = origin_prompt.copy()
        id_to_class_type = {id: details["class_type"] for id, details in prompt.items()}
        k_sampler = [key for key, value in id_to_class_type.items() if value == "KSampler"][0]
        prompt.get(k_sampler)["inputs"]["seed"] = random.randint(10**14, 10**15 - 1)
        positive_input_id = prompt.get(k_sampler)["inputs"]["positive"][0]
        prompt.get(positive_input_id)["inputs"]["text"] = positive_prompt

        if negative_prompt != "":
            negative_input_id = prompt.get(k_sampler)["inputs"]["negative"][0]
            prompt.get(negative_input_id)["inputs"]["text"] = negative_prompt

        if image_name != "":
            image_loader = [key for key, value in id_to_class_type.items() if value == "LoadImage"][0]
            prompt.get(image_loader)["inputs"]["image"] = image_name
        return prompt

    def track_progress(self, prompt: dict, ws: WebSocket, prompt_id: str):
        node_ids = list(prompt.keys())
        finished_nodes = []

        while True:
            out = ws.recv()
            if isinstance(out, str):
                message = json.loads(out)
                if message["type"] == "progress":
                    data = message["data"]
                    current_step = data["value"]
                    print("In K-Sampler -> Step: ", current_step, " of: ", data["max"])
                if message["type"] == "execution_cached":
                    data = message["data"]
                    for itm in data["nodes"]:
                        if itm not in finished_nodes:
                            finished_nodes.append(itm)
                            print("Progress: ", len(finished_nodes), "/", len(node_ids), " Tasks done")
                if message["type"] == "executing":
                    data = message["data"]
                    if data["node"] not in finished_nodes:
                        finished_nodes.append(data["node"])
                        print("Progress: ", len(finished_nodes), "/", len(node_ids), " Tasks done")

                    if data["node"] is None and data["prompt_id"] == prompt_id:
                        break  # Execution is done
            else:
                continue

    def generate_image_by_prompt(self, prompt: dict) -> list[bytes]:
        try:
            ws, client_id = self.open_websocket_connection()
            prompt_id = self.queue_prompt(client_id, prompt)
            self.track_progress(prompt, ws, prompt_id)
            history = self.get_history(prompt_id)
            images = []
            for output in history["outputs"].values():
                for img in output.get("images", []):
                    image_data = self.get_image(img["filename"], img["subfolder"], img["type"])
                    images.append(image_data)
            return images
        finally:
            ws.close()
