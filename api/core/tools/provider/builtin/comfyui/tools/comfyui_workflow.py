import json
from typing import Any

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.comfyui.tools.comfyui_client import ComfyUiClient
from core.tools.tool.builtin_tool import BuiltinTool


class ComfyUIWorkflowTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        comfyui = ComfyUiClient(self.runtime.credentials["base_url"])

        positive_prompt = tool_parameters.get("positive_prompt")
        negative_prompt = tool_parameters.get("negative_prompt")
        workflow = tool_parameters.get("workflow_json")
        image_name = ""
        if image := tool_parameters.get("image"):
            image_name = comfyui.upload_image(image).get("name")

        try:
            origin_prompt = json.loads(workflow)
        except:
            return self.create_text_message("the Workflow JSON is not correct")

        prompt = comfyui.set_prompt(origin_prompt, positive_prompt, negative_prompt, image_name)
        images = comfyui.generate_image_by_prompt(prompt)
        result = []
        for img in images:
            result.append(
                self.create_blob_message(
                    blob=img, meta={"mime_type": "image/png"}, save_as=self.VariableKey.IMAGE.value
                )
            )
        return result
