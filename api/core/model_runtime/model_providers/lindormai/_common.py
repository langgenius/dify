import json
from collections.abc import Mapping
from typing import Any
from urllib.error import HTTPError, URLError

import requests

from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError


def _check_credentials_fields(credentials: Mapping) -> None:
    if "lindormai_endpoint" not in credentials:
        raise CredentialsValidateFailedError("LindormAI EndPoint must be provided")
    if "lindormai_username" not in credentials:
        raise CredentialsValidateFailedError("LindormAI Username must be provided")
    if "lindormai_password" not in credentials:
        raise CredentialsValidateFailedError("LindormAI Password must be provided")


class _CommonLindormAI:
    HTTP_HDR_AK_KEY = "x-ld-ak"
    HTTP_HDR_SK_KEY = "x-ld-sk"
    REST_URL_PATH = "/v1/ai"
    REST_URL_MODELS_PATH = REST_URL_PATH + "/models"
    INFER_INPUT_KEY = "input"
    INFER_PARAMS_KEY = "params"
    RSP_DATA_KEY = "data"
    RSP_MODELS_KEY = "models"

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeConnectionError: [URLError],
            InvokeServerUnavailableError: [HTTPError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [InvokeBadRequestError, KeyError, ValueError, json.JSONDecodeError],
        }

    def _post(self, url, data=None, json=None, **kwargs):
        response = requests.post(url=url, data=data, json=json, **kwargs)
        response.raise_for_status()
        return response

    def _get(self, url, params=None, **kwargs):
        response = requests.get(url=url, params=params, **kwargs)
        response.raise_for_status()
        return response

    def _check_model_status(self, model: str, credentials: Mapping) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            endpoint = credentials.get("lindormai_endpoint")
            username = credentials.get("lindormai_username")
            passwd = credentials.get("lindormai_password")
            headers = {_CommonLindormAI.HTTP_HDR_AK_KEY: username, _CommonLindormAI.HTTP_HDR_SK_KEY: passwd}
            url = f"{endpoint}{_CommonLindormAI.REST_URL_MODELS_PATH}/{model}/status"
            response = self._get(url, headers=headers)
            if response.status_code != 200:
                raise ValueError("UserName or PassWord is invalid.")
            msg = response.json().get("msg", "ERROR:No Response Msg")
            if msg != "SUCCESS":
                raise ValueError(msg)
            data = response.json().get("data", {})
            status = data.get("status", "")
            if status != "READY":
                raise ValueError("Model is not in READY status")
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    def _infer_model(self, model: str, credentials: Mapping, input_data: Any, params: dict) -> dict:
        _check_credentials_fields(credentials)
        endpoint = credentials.get("lindormai_endpoint")
        username = credentials.get("lindormai_username")
        passwd = credentials.get("lindormai_password")
        headers = {_CommonLindormAI.HTTP_HDR_AK_KEY: username, _CommonLindormAI.HTTP_HDR_SK_KEY: passwd}
        url = f"{endpoint}{_CommonLindormAI.REST_URL_MODELS_PATH}/{model}/infer"
        infer_dict = {_CommonLindormAI.INFER_INPUT_KEY: input_data, _CommonLindormAI.INFER_PARAMS_KEY: params}
        response = self._post(url, json=infer_dict, headers=headers)
        response.raise_for_status()
        result = response.json()
        return result[_CommonLindormAI.RSP_DATA_KEY] if result else None
