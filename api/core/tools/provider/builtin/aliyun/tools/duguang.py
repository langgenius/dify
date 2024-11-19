import json
from typing import Any, Union

from alibabacloud_ocr_api20210707 import models as ocr_model
from alibabacloud_ocr_api20210707.client import Client as ocrClient
from alibabacloud_tea_openapi import models as open_api_models
from alibabacloud_tea_util import models as util_models
from alibabacloud_tea_util.client import Client as utilClient

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool.builtin_tool import BuiltinTool


class DuGuangTool(BuiltinTool):
    """
    An OCR tool
    """

    def _invoke(
            self,
            user_id: str,
            tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        image_url = tool_parameters.get("image_url", "").strip()
        if not image_url:
            return self.create_text_message("Invalid image_url")
        ocr_result = self._ocr_image_url(image_url)
        return self.create_text_message(ocr_result)

    def _ocr_image_url(
            self,
            image_url: str
    ) -> str:
        client = self._create_client()
        recognize_request = ocr_model.RecognizeAdvancedRequest(
            url=image_url,
            need_rotate=False
        )
        try:
            result = client.recognize_advanced_with_options(recognize_request, util_models.RuntimeOptions())
            return self._parse_result(result)
        except Exception as e:
            return f"DuGuangTool Exception {str(e)}"

    def _create_client(self) -> ocrClient:
        access_key_id = self.runtime.credentials["access_key_id"]
        access_key_secret = self.runtime.credentials["access_key_secret"]
        config = open_api_models.Config(
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
        )
        config.endpoint = 'ocr-api.cn-hangzhou.aliyuncs.com'
        return ocrClient(config)

    def _parse_result(self, result: ocr_model.RecognizeAdvancedResponse) -> str:
        data_str = utilClient.to_jsonstring(result.body.data)
        data_json = json.loads(data_str)
        return data_json.get("content")
