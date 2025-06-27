import logging
from typing import Any, Optional

import requests
from yarl import URL

from configs import dify_config


# leave it here for later use
class KagentsService:
    """
    Service for interacting with Kagents API.
    """

    _ENDPOINT_SEGMENTS = ("kagent", "chat", "conversationRecordDetail")

    def __init__(self, token) -> None:
        self._token: URL = token
        self._base_url: URL = URL(str(dify_config.KAGENTS_URL))
        self._session = requests.Session()
        self._session.headers.update(
            {"Content-Type": "application/json", "Accept": "*/*"}
        )

    def query_conversation_by_id(
        self, token: str, conversation_id: str
    ) -> Optional[list[dict[str, Any]]]:
        endpoint = self._base_url.with_path("/".join(self._ENDPOINT_SEGMENTS))
        headers = {"token": self._token}

        try:
            resp = self._session.post(
                str(endpoint), headers=headers, json={"conversationId": conversation_id}
            )
            resp.raise_for_status()
            body = resp.json().get("responseBody", [])
        except (requests.HTTPError, ValueError) as exc:
            logging.exception("Error fetching conversation %s", conversation_id)
            return None

        for entry in body:
            if plan_info := entry.get("result").get("plan_info"):
                return plan_info

        return None
