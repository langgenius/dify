from typing import Any, Union

from httpx import post

from core.file.enums import FileType
from core.file.file_manager import download
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.errors import ToolParameterValidationError
from core.tools.tool.builtin_tool import BuiltinTool


class VectorizerTool(BuiltinTool):
    def _invoke(
        self, user_id: str, tool_parameters: dict[str, Any]
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        api_key_name = self.runtime.credentials.get("api_key_name")
        api_key_value = self.runtime.credentials.get("api_key_value")
        mode = tool_parameters.get("mode", "test")

        # image file for workflow mode
        image = tool_parameters.get("image")
        if image and image.type != FileType.IMAGE:
            raise ToolParameterValidationError("Not a valid image")
        # image_id for agent mode
        image_id = tool_parameters.get("image_id", "")

        if image_id:
            image_binary = self.get_variable_file(self.VariableKey.IMAGE)
            if not image_binary:
                return self.create_text_message("Image not found, please request user to generate image firstly.")
        elif image:
            image_binary = download(image)
        else:
            raise ToolParameterValidationError("Please provide either image or image_id")

        response = post(
            "https://vectorizer.ai/api/v1/vectorize",
            data={"mode": mode},
            files={"image": image_binary},
            auth=(api_key_name, api_key_value),
            timeout=30,
        )

        if response.status_code != 200:
            raise Exception(response.text)

        return [
            self.create_text_message("the vectorized svg is saved as an image."),
            self.create_blob_message(blob=response.content, meta={"mime_type": "image/svg+xml"}),
        ]

    def get_runtime_parameters(self) -> list[ToolParameter]:
        """
        override the runtime parameters
        """
        return [
            ToolParameter.get_simple_instance(
                name="image_id",
                llm_description=f"the image_id that you want to vectorize, \
                    and the image_id should be specified in \
                        {[i.name for i in self.list_default_image_variables()]}",
                type=ToolParameter.ToolParameterType.SELECT,
                required=False,
                options=[i.name for i in self.list_default_image_variables()],
            ),
            ToolParameter(
                name="image",
                label=I18nObject(en_US="image", zh_Hans="image"),
                human_description=I18nObject(
                    en_US="The image to be converted.",
                    zh_Hans="要转换的图片。",
                ),
                type=ToolParameter.ToolParameterType.FILE,
                form=ToolParameter.ToolParameterForm.LLM,
                llm_description="you should not input this parameter. just input the image_id.",
                required=False,
            ),
        ]
