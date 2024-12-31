import json
import mimetypes
from typing import Any

from core.file import FileType
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolParameterValidationError
from core.tools.provider.builtin.comfyui.tools.comfyui_client import ComfyUiClient
from core.tools.tool.builtin_tool import BuiltinTool


def sanitize_json_string(s):
    escape_dict = {
        "\n": "\\n",
        "\r": "\\r",
        "\t": "\\t",
        "\b": "\\b",
        "\f": "\\f",
    }
    for char, escaped in escape_dict.items():
        s = s.replace(char, escaped)

    return s


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
            workflow = workflow.replace("{{positive_prompt}}", positive_prompt.replace('"', "'"))
            workflow = workflow.replace("{{negative_prompt}}", negative_prompt.replace('"', "'"))

        try:
            prompt = json.loads(workflow)
        except json.JSONDecodeError:
            cleaned_string = sanitize_json_string(workflow)
            try:
                prompt = json.loads(cleaned_string)
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

        if seed_id := tool_parameters.get("seed_id"):
            prompt = comfyui.set_prompt_seed_by_id(prompt, seed_id)

        images = comfyui.generate_image_by_prompt(prompt)
        result = []
        for image_data, filename in images:
            result.append(
                self.create_blob_message(
                    blob=image_data,
                    meta={"mime_type": mimetypes.guess_type(filename)[0]},
                    save_as=self.VariableKey.IMAGE.value,
                )
            )
        return result
