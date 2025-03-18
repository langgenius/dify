import json
import logging
from typing import Optional

from alibabacloud_dysmsapi20170525 import models as dysmsapi_20170525_models
from alibabacloud_dysmsapi20170525.client import Client as Dysmsapi20170525Client
from alibabacloud_tea_openapi import models as open_api_models
from alibabacloud_tea_util import models as util_models
from alibabacloud_tea_util.client import Client as UtilClient
from configs import dify_config
from dify_app import DifyApp
from flask import Flask


class PhoneSms:
    def __init__(self):
        self._client: Optional[Dysmsapi20170525Client] = None

    def init_app(self, app: Flask):
        if not dify_config.ALIYUN_ACCESS_KEY_ID or not dify_config.ALIYUN_ACCESS_KEY_SECRET:
            logging.warning("ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET must be set")
            return

        if not dify_config.ALIYUN_SIGN_NAME or not dify_config.ALIYUN_TEMPLATE_CODE:
            logging.warning("ALIYUN_SIGN_NAME and ALIYUN_TEMPLATE_CODE must be set")
            return

        self._client = self._create_client(dify_config.ALIYUN_ACCESS_KEY_ID, dify_config.ALIYUN_ACCESS_KEY_SECRET)
        self._sign_name = dify_config.ALIYUN_SIGN_NAME
        self._template_code = dify_config.ALIYUN_TEMPLATE_CODE

    def is_inited(self) -> bool:
        return self._client is not None

    def _create_client(self, id: str, secret: str) -> Dysmsapi20170525Client:
        """
        使用AK&SK初始化账号Client
        @return: Client
        @throws Exception
        """
        # 工程代码泄露可能会导致 AccessKey 泄露，并威胁账号下所有资源的安全性。以下代码示例仅供参考。
        # 建议使用更安全的 STS 方式，更多鉴权访问方式请参见：https://help.aliyun.com/document_detail/378659.html。
        config = open_api_models.Config(
            # 必填，请确保代码运行环境设置了环境变量 ALIBABA_CLOUD_ACCESS_KEY_ID。,
            access_key_id=id,
            # 必填，请确保代码运行环境设置了环境变量 ALIBABA_CLOUD_ACCESS_KEY_SECRET。,
            access_key_secret=secret,
        )
        # Endpoint 请参考 https://api.aliyun.com/product/Dysmsapi
        config.endpoint = f'dysmsapi.aliyuncs.com'
        return Dysmsapi20170525Client(config)

    def send_sms(self, phone_numbers: str, code: str) -> None:

        if not self._client:
            raise ValueError("PhoneSms client is not initialized")

        send_sms_request = dysmsapi_20170525_models.SendSmsRequest(
            phone_numbers=phone_numbers,
            sign_name=self._sign_name,
            template_code=self._template_code,
            template_param=json.dumps({"code": code}),
        )

        response = self._client.send_sms_with_options(send_sms_request, util_models.RuntimeOptions())
        if response.body.code != 'OK':
            raise Exception(response.body.message)


def init_app(app: DifyApp):
    phone_sms.init_app(app)
    app.extensions["phone_sms"] = phone_sms


phone_sms = PhoneSms()
