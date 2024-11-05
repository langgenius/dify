import json
from typing import Any

from core.file import FileType
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolParameterValidationError
from core.tools.provider.builtin.comfyui.tools.comfyui_client import ComfyUiClient
from core.tools.tool.builtin_tool import BuiltinTool


class ComfyUIWorkflowTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]) -> ToolInvokeMessage | list[ToolInvokeMessage]:
        comfyui = ComfyUiClient(self.runtime.credentials["base_url"])

        positive_prompt = tool_parameters.get("positive_prompt", "")
        negative_prompt = tool_parameters.get("negative_prompt", "")
        images = tool_parameters.get("images") or []
        workflow = tool_parameters.get("workflow_json")
        image_names = []
        for image in images:
            if image.type != FileType.IMAGE:
                continue
            image_name = comfyui.upload_image(image).get("name")
            image_names.append(image_name)

        set_prompt_with_ksampler = True
        if "{{positive_prompt}}" in workflow:
            set_prompt_with_ksampler = False
            workflow = workflow.replace("{{positive_prompt}}", positive_prompt)
            workflow = workflow.replace("{{negative_prompt}}", negative_prompt)

        try:
            prompt = json.loads(workflow)
        except:
            return self.create_text_message("the Workflow JSON is not correct")

        if set_prompt_with_ksampler:
            try:
                prompt = comfyui.set_prompt_by_ksampler(prompt, positive_prompt, negative_prompt)
            except:
                raise ToolParameterValidationError(
                    "Failed set prompt with KSampler, try replace prompt to {{positive_prompt}} in your workflow json"
                )

        if image_names:
            if image_ids := tool_parameters.get("image_ids"):
                image_ids = image_ids.split(",")
                try:
                    prompt = comfyui.set_prompt_images_by_ids(prompt, image_names, image_ids)
                except:
                    raise ToolParameterValidationError("the Image Node ID List not match your upload image files.")
            else:
                prompt = comfyui.set_prompt_images_by_default(prompt, image_names)

        images = comfyui.generate_image_by_prompt(prompt)
        result = []
        for img in images:
            result.append(
                self.create_blob_message(
                    blob=img, meta={"mime_type": "image/png"}, save_as=self.VariableKey.IMAGE.value
                )
            )
        return result
