import random
from hashlib import md5
from typing import Any, Union

import requests

from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.provider.builtin.baidu_translate._baidu_translate_tool_base import BaiduTranslateToolBase
from core.tools.tool.builtin_tool import BuiltinTool


class BaiduFieldTranslateTool(BuiltinTool, BaiduTranslateToolBase):
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
    ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:
        """
        invoke tools
        """
        BAIDU_FIELD_TRANSLATE_URL = "https://fanyi-api.baidu.com/api/trans/vip/fieldtranslate"

        appid = self.runtime.credentials.get("appid", "")
        if not appid:
            raise ValueError("invalid baidu translate appid")

        secret = self.runtime.credentials.get("secret", "")
        if not secret:
            raise ValueError("invalid baidu translate secret")

        q = tool_parameters.get("q", "")
        if not q:
            raise ValueError("Please input text to translate")

        from_ = tool_parameters.get("from", "")
        if not from_:
            raise ValueError("Please select source language")

        to = tool_parameters.get("to", "")
        if not to:
            raise ValueError("Please select destination language")

        domain = tool_parameters.get("domain", "")
        if not domain:
            raise ValueError("Please select domain")

        salt = str(random.randint(32768, 16777215))
        sign = self._get_sign(appid, secret, salt, q, domain)

        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        params = {
            "q": q,
            "from": from_,
            "to": to,
            "appid": appid,
            "salt": salt,
            "domain": domain,
            "sign": sign,
            "needIntervene": 1,
        }
        try:
            response = requests.post(BAIDU_FIELD_TRANSLATE_URL, headers=headers, data=params)
            result = response.json()

            if "trans_result" in result:
                result_text = result["trans_result"][0]["dst"]
            else:
                result_text = f'{result["error_code"]}: {result["error_msg"]}'

            return self.create_text_message(str(result_text))
        except requests.RequestException as e:
            raise ValueError(f"Translation service error: {e}")
        except Exception:
            raise ValueError("Translation service error, please check the network")

    def _get_sign(self, appid, secret, salt, query, domain):
        str = appid + query + salt + domain + secret
        return md5(str.encode("utf-8")).hexdigest()
