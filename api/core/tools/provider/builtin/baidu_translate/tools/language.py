import random
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.baidu_translate._baidu_translate_tool_base import BaiduTranslateToolBase
from core.tools.tool.builtin_tool import BuiltinTool


class BaiduLanguageTool(BuiltinTool, BaiduTranslateToolBase):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        BAIDU_LANGUAGE_URL = "https://fanyi-api.baidu.com/api/trans/vip/language"

        appid = self.runtime.credentials.get("appid", "")
        if not appid:
            raise ValueError("invalid baidu translate appid")

        secret = self.runtime.credentials.get("secret", "")
        if not secret:
            raise ValueError("invalid baidu translate secret")

        q = tool_parameters.get("q", "")
        if not q:
            raise ValueError("Please input text to translate")

        description_language = tool_parameters.get("description_language", "English")

        salt = str(random.randint(32768, 16777215))
        sign = self._get_sign(appid, secret, salt, q)

        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        params = {
            "q": q,
            "appid": appid,
            "salt": salt,
            "sign": sign,
        }

        try:
            response = requests.post(BAIDU_LANGUAGE_URL, params=params, headers=headers)
            result = response.json()
            if "error_code" not in result:
                raise ValueError("Translation service error, please check the network")

            result_text = ""
            if result["error_code"] != 0:
                result_text = f'{result["error_code"]}: {result["error_msg"]}'
            else:
                result_text = result["data"]["src"]
                result_text = self.mapping_result(description_language, result_text)

            return self.create_text_message(result_text)
        except requests.RequestException as e:
            raise ValueError(f"Translation service error: {e}")
        except Exception:
            raise ValueError("Translation service error, please check the network")

    def mapping_result(self, description_language: str, result: str) -> str:
        """
        mapping result
        """
        mapping = {
            "English": {
                "zh": "Chinese",
                "en": "English",
                "jp": "Japanese",
                "kor": "Korean",
                "th": "Thai",
                "vie": "Vietnamese",
                "ru": "Russian",
            },
            "Chinese": {
                "zh": "中文",
                "en": "英文",
                "jp": "日文",
                "kor": "韩文",
                "th": "泰语",
                "vie": "越南语",
                "ru": "俄语",
            },
        }

        language_mapping = mapping.get(description_language)
        if not language_mapping:
            return result

        return language_mapping.get(result, result)
