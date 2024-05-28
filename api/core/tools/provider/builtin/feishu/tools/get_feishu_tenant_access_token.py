import json
import logging
from typing import Any, Union

import coloredlogs
import httpx
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.err_code.err_code import StatusCodeEnum
from core.tools.tool.builtin_tool import BuiltinTool
from extensions.ext_redis import redis_client

logger = logging.getLogger(__name__)
coloredlogs.install(level='DEBUG', logger=logger)


class FeishuGroupBotTool(BuiltinTool):
    def _invoke(self, user_id: str, tool_parameters: dict[str, Any]
                ) -> Union[ToolInvokeMessage, list[ToolInvokeMessage]]:

        app_id = tool_parameters.get('app_id', '')
        if not app_id:
            return self.create_text_message(json.dumps({
                "code": StatusCodeEnum.IllegalParameter.value[0],
                "msg": 'Invalid parameter app_id'
            }))

        app_secret = tool_parameters.get('app_secret', '')
        if not app_secret:
            return self.create_text_message(json.dumps({
                "code": StatusCodeEnum.IllegalParameter.value[0],
                "msg": 'Invalid parameter app_secret'
            }))

        cache_key = 'tenant_access_token:{app_id}'.format(app_id=app_id)

        tenant_access_token = redis_client.get(cache_key)
        if tenant_access_token:
            logging.info(f'[redis]Get tenant access token: {tenant_access_token.decode()}')
            return self.create_text_message(json.dumps({
                "code": StatusCodeEnum.OK.value[0],
                "msg": StatusCodeEnum.OK.value[1],
                "tenant_access_token": tenant_access_token.decode()
            }))

        api_url = "https://open.larkoffice.com/open-apis/auth/v3/tenant_access_token/internal"

        headers = {
            'Content-Type': 'application/json',
        }

        params = {}

        payload = {
            "app_id": app_id,
            "app_secret": app_secret
        }

        try:
            res = httpx.post(api_url, headers=headers, params=params, json=payload)
            if res.is_success:
                logging.info(f'Get tenant access token res: {json.dumps(res.text, indent=4)}')

                res_obj = res.json()
                code = res_obj['code']
                if code == 0:
                    tenant_access_token = res_obj['tenant_access_token']
                    redis_client.setex(cache_key, 5400, tenant_access_token)
                    return self.create_text_message(json.dumps({
                        "code": StatusCodeEnum.OK.value[0],
                        "msg": StatusCodeEnum.OK.value[1],
                        "tenant_access_token": tenant_access_token
                    }))

                return self.create_text_message(json.dumps({
                    "code": code,
                    "msg": res_obj['msg'],
                }))
            else:
                logging.warning(f'Get tenant access token fail: {str(res)}')
                return self.create_text_message(json.dumps({
                    "code": res.status_code,
                    "msg": res.text,
                }))
        except Exception as e:
            data = {
                "code": StatusCodeEnum.ServerErr.value[0],
                "msg": e,
            }
            return self.create_text_message(json.dumps(data))
