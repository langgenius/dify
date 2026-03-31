import re
from typing import Any
from urllib.parse import quote

from core.helper.ssrf_proxy import ssrf_proxy
from core.tools.errors import ToolInvokeError

_SYS_ID_PATTERN = re.compile(r"^[a-fA-F0-9]{32}$")


class ServiceNowClient:
    def __init__(self, credentials: dict[str, Any]):
        instance_url = str(credentials.get("instance_url", "")).strip().rstrip("/")
        username = str(credentials.get("username", "")).strip()
        password = str(credentials.get("password", "")).strip()

        if not instance_url:
            raise ToolInvokeError("ServiceNow credential `instance_url` is required.")
        if not username:
            raise ToolInvokeError("ServiceNow credential `username` is required.")
        if not password:
            raise ToolInvokeError("ServiceNow credential `password` is required.")

        self._instance_url = instance_url
        self._auth = (username, password)
        self._headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def validate_connection(self):
        self._request(
            "get",
            "/api/now/table/incident",
            params={
                "sysparm_limit": "1",
                "sysparm_fields": "sys_id",
            },
        )

    def create_incident(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = self._request("post", "/api/now/table/incident", body=payload)
        result = data.get("result")
        if not isinstance(result, dict):
            raise ToolInvokeError("ServiceNow returned an unexpected response for create incident.")
        return result

    def get_incident(self, incident_number_or_sys_id: str) -> dict[str, Any]:
        sys_id = self._resolve_incident_sys_id(incident_number_or_sys_id)
        data = self._request(
            "get",
            f"/api/now/table/incident/{quote(sys_id, safe='')}",
            params={
                "sysparm_display_value": "true",
            },
        )
        result = data.get("result")
        if not isinstance(result, dict):
            raise ToolInvokeError("ServiceNow returned an unexpected response for get incident.")
        return result

    def update_incident(self, incident_number_or_sys_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        sys_id = self._resolve_incident_sys_id(incident_number_or_sys_id)
        data = self._request(
            "patch",
            f"/api/now/table/incident/{quote(sys_id, safe='')}",
            body=payload,
        )
        result = data.get("result")
        if not isinstance(result, dict):
            raise ToolInvokeError("ServiceNow returned an unexpected response for update incident.")
        return result

    def _resolve_incident_sys_id(self, incident_number_or_sys_id: str) -> str:
        identifier = incident_number_or_sys_id.strip()
        if not identifier:
            raise ToolInvokeError("`incident_number_or_sys_id` is required.")

        if _SYS_ID_PATTERN.match(identifier):
            return identifier

        data = self._request(
            "get",
            "/api/now/table/incident",
            params={
                "sysparm_query": f"number={identifier}",
                "sysparm_limit": "1",
                "sysparm_fields": "sys_id,number",
            },
        )

        result = data.get("result")
        if not isinstance(result, list) or not result:
            raise ToolInvokeError(f"Incident `{identifier}` was not found in ServiceNow.")

        first_item = result[0]
        if not isinstance(first_item, dict):
            raise ToolInvokeError("ServiceNow returned an unexpected lookup payload.")

        sys_id = first_item.get("sys_id")
        if not isinstance(sys_id, str) or not sys_id:
            raise ToolInvokeError("ServiceNow response does not include a valid incident sys_id.")

        return sys_id

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{self._instance_url}{path}"
        requester = getattr(ssrf_proxy, method.lower())
        response = requester(
            url,
            headers=self._headers,
            params=params,
            json=body,
            auth=self._auth,
            timeout=(10, 30),
        )

        if response.status_code >= 400:
            raise ToolInvokeError(self._extract_error_message(response))

        try:
            data = response.json()
        except ValueError as exc:
            raise ToolInvokeError("ServiceNow returned a non-JSON response.") from exc

        if not isinstance(data, dict):
            raise ToolInvokeError("ServiceNow returned an unexpected response payload.")

        return data

    @staticmethod
    def _extract_error_message(response: Any) -> str:
        status = getattr(response, "status_code", "unknown")
        message = f"ServiceNow request failed with status code {status}."
        try:
            payload = response.json()
        except Exception:
            return message

        if not isinstance(payload, dict):
            return message

        error_obj = payload.get("error")
        if isinstance(error_obj, dict):
            detail = error_obj.get("message") or error_obj.get("detail")
            if isinstance(detail, str) and detail.strip():
                return f"{message} {detail.strip()}"

        message_value = payload.get("message")
        if isinstance(message_value, str) and message_value.strip():
            return f"{message} {message_value.strip()}"

        return message
