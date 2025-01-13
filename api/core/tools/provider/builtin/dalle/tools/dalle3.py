import base64
import random
from typing import Any, Union

from openai import OpenAI
from yarl import URL

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DallE3Tool(BuiltinTool):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        openai_organization = self.runtime.credentials.get("openai_organization_id", None)
        if not openai_organization:
            openai_organization = None
        openai_base_url = self.runtime.credentials.get("openai_base_url", None)
        if not openai_base_url:
            openai_base_url = None
        else:
            openai_base_url = str(URL(openai_base_url) / "v1")

        client = OpenAI(
            api_key=self.runtime.credentials["openai_api_key"],
            base_url=openai_base_url,
            organization=openai_organization,
        )

        SIZE_MAPPING = {
            "square": "1024x1024",
            "vertical": "1024x1792",
            "horizontal": "1792x1024",
        }

        # prompt
        prompt = tool_parameters.get("prompt", "")
        if not prompt:
            return self.create_text_message("Please input prompt")
        # get size
        size = SIZE_MAPPING[tool_parameters.get("size", "square")]
        # get n
        n = tool_parameters.get("n", 1)
        # get quality
        quality = tool_parameters.get("quality", "standard")
        if quality not in {"standard", "hd"}:
            return self.create_text_message("Invalid quality")
        # get style
        style = tool_parameters.get("style", "vivid")
        if style not in {"natural", "vivid"}:
            return self.create_text_message("Invalid style")

        # call openapi dalle3
        response = client.images.generate(
            prompt=prompt, model="dall-e-3", size=size, n=n, style=style, quality=quality, response_format="b64_json"
        )

        result = []

        for image in response.data:
            mime_type, blob_image = DallE3Tool._decode_image(image.b64_json)
            blob_message = self.create_blob_message(
                blob=blob_image, meta={"mime_type": mime_type}, save_as=self.VariableKey.IMAGE
            )
            result.append(blob_message)
        return result

    @staticmethod
    def _decode_image(base64_image: str) -> tuple[str, bytes]:
        """
        Decode a base64 encoded image. If the image is not prefixed with a MIME type,
        it assumes 'image/png' as the default.

        :param base64_image: Base64 encoded image string
        :return: A tuple containing the MIME type and the decoded image bytes
        """
        if DallE3Tool._is_plain_base64(base64_image):
            return "image/png", base64.b64decode(base64_image)
        else:
            return DallE3Tool._extract_mime_and_data(base64_image)

    @staticmethod
    def _is_plain_base64(encoded_str: str) -> bool:
        """
        Check if the given encoded string is plain base64 without a MIME type prefix.

        :param encoded_str: Base64 encoded image string
        :return: True if the string is plain base64, False otherwise
        """
        return not encoded_str.startswith("data:image")

    @staticmethod
    def _extract_mime_and_data(encoded_str: str) -> tuple[str, bytes]:
        """
        Extract MIME type and image data from a base64 encoded string with a MIME type prefix.

        :param encoded_str: Base64 encoded image string with MIME type prefix
        :return: A tuple containing the MIME type and the decoded image bytes
        """
        mime_type = encoded_str.split(";")[0].split(":")[1]
        image_data_base64 = encoded_str.split(",")[1]
        decoded_data = base64.b64decode(image_data_base64)
        return mime_type, decoded_data

    @staticmethod
    def _generate_random_id(length=8):
        characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        random_id = "".join(random.choices(characters, k=length))
        return random_id
