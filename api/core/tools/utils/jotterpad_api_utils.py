from typing import Optional

import httpx

from core.tools.errors import ToolProviderCredentialValidationError


def jotterpad_auth(credentials):
    jotterpad_api_key = credentials.get("jotterpad_api_key")
    if not jotterpad_api_key:
        raise ToolProviderCredentialValidationError("jotterpad_api_key is required")
    try:
        assert JotterPadRequest(jotterpad_api_key).probe() is True
    except Exception as e:
        raise ToolProviderCredentialValidationError(str(e))


class JotterPadRequest:
    API_BASE_URL = "https://jotterpad.app/publicApi/v1"

    def __init__(self, jotterpad_api_key: str):
        self.jotterpad_api_key = jotterpad_api_key

    def _send_request(
        self,
        url: str,
        method: str = "post",
        require_auth: bool = True,
        payload: Optional[dict] = None,
        params: Optional[dict] = None,
    ):
        headers = {
            "Content-Type": "application/json",
            "user-agent": "Dify",
        }
        if require_auth:
            headers["Authorization"] = f"Apikey {self.jotterpad_api_key}"
        res = httpx.request(method=method, url=url, headers=headers, json=payload, params=params, timeout=30).json()
        if res.get("status") == "auth_required":
            raise ValueError("Authorization failed. Please enter your JotterPad API key again.")
        elif res.get("status") != "ok":
            raise Exception(res)
        return res

    def probe(self) -> bool:
        url = f"{self.API_BASE_URL}/auth/probe"
        res = self._send_request(url)
        return True

    def get_export_document_files(self) -> dict:
        url = f"{self.API_BASE_URL}/exports/list"
        res = self._send_request(url)
        if "exportedFiles" in res:
            return res.get("exportedFiles")
        return None

    def get_export_document_file(self, export_id) -> dict:
        url = f"{self.API_BASE_URL}/exports/get"
        payload = {"exportId": export_id}
        res = self._send_request(url=url, payload=payload)
        if "exportedFile" in res:
            return res.get("exportedFile")
        return None

    def clear_export_document_files(self) -> bool:
        url = f"{self.API_BASE_URL}/exports/clear"
        res = self._send_request(url)
        if "status" in res:
            return res.get("status") == "ok"
        return False

    def initiate_print_or_export(self, in_type: str, out_type, input_content: str, metadata: str, name: str) -> str:
        url = f"{self.API_BASE_URL}/exports/upload/{in_type}/{out_type}"
        payload = {"input": input_content, "metadata": metadata, "name": name}
        res = self._send_request(url=url, payload=payload)
        if "id" in res:
            return res.get("id")
        return None
