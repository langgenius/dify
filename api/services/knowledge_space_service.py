"""Minimal server-side bridge to the KnowledgeFS OpenAPI client.

This bridge uses one server-only token bound to one KFS tenant. Dify
rejects any other workspace before I/O and validates the tenant echoed by KFS;
the generated client remains the owner of the HTTP wire contract. Connection
setting changes require an API process restart because the client is pooled.
"""

from __future__ import annotations

from http import HTTPStatus

import httpx

from clients.knowledge_fs.generated.api.knowledge_spaces import create_knowledge_space, list_knowledge_spaces
from clients.knowledge_fs.generated.client import Client as GeneratedKnowledgeFSClient
from clients.knowledge_fs.generated.models import (
    CreateKnowledgeSpace,
    KnowledgeSpaceCreationResponse,
    KnowledgeSpaceList,
)
from clients.knowledge_fs.generated.types import UNSET
from configs import dify_config
from core.helper.http_client_pooling import get_pooled_http_client


class KnowledgeFSConfigurationError(RuntimeError):
    """KnowledgeFS is partially configured or bound to another workspace."""


class KnowledgeFSUpstreamError(RuntimeError):
    """KnowledgeFS could not return a valid response."""

    status_code: int | None

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        self.status_code = status_code
        super().__init__(message)


class KnowledgeFSTimeoutError(KnowledgeFSUpstreamError):
    """KnowledgeFS exceeded the configured request timeout."""


class KnowledgeSpaceService:
    """Call the two KnowledgeFS operations exposed to the Console."""

    _client: GeneratedKnowledgeFSClient
    _expected_tenant_id: str

    def __init__(self, client: GeneratedKnowledgeFSClient, *, expected_tenant_id: str) -> None:
        self._client = client
        self._expected_tenant_id = expected_tenant_id

    def list_knowledge_spaces(
        self,
        *,
        limit: int,
        cursor: str | None,
        tenant_id: str,
    ) -> KnowledgeSpaceList:
        """List one KFS cursor page after enforcing the static tenant binding."""
        self._ensure_tenant(tenant_id)
        try:
            response = list_knowledge_spaces.sync_detailed(
                client=self._client,
                limit=limit,
                cursor=cursor if cursor is not None else UNSET,
            )
        except httpx.TimeoutException as exc:
            raise KnowledgeFSTimeoutError("KnowledgeFS request timed out") from exc
        except httpx.HTTPError as exc:
            raise KnowledgeFSUpstreamError("KnowledgeFS transport request failed") from exc
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            raise KnowledgeFSUpstreamError("KnowledgeFS returned an invalid response") from exc

        if response.status_code != HTTPStatus.OK:
            raise KnowledgeFSUpstreamError(
                f"KnowledgeFS returned HTTP {response.status_code}",
                status_code=int(response.status_code),
            )
        if not isinstance(response.parsed, KnowledgeSpaceList):
            raise KnowledgeFSUpstreamError("KnowledgeFS returned an invalid list response")
        if response.parsed.next_cursor is not UNSET and not isinstance(response.parsed.next_cursor, str):
            raise KnowledgeFSUpstreamError("KnowledgeFS returned an invalid pagination cursor")
        if any(space.tenant_id != tenant_id for space in response.parsed.items):
            raise KnowledgeFSUpstreamError("KnowledgeFS returned data for another tenant")
        return response.parsed

    def create_knowledge_space(
        self,
        *,
        idempotency_key: str,
        name: str,
        description: str | None,
        tenant_id: str,
    ) -> KnowledgeSpaceCreationResponse:
        """Create an empty KFS space after enforcing the static tenant binding."""
        self._ensure_tenant(tenant_id)
        body = CreateKnowledgeSpace(
            idempotency_key=idempotency_key,
            name=name,
            description=description if description is not None else UNSET,
        )
        try:
            response = create_knowledge_space.sync_detailed(client=self._client, body=body)
        except httpx.TimeoutException as exc:
            raise KnowledgeFSTimeoutError("KnowledgeFS request timed out") from exc
        except httpx.HTTPError as exc:
            raise KnowledgeFSUpstreamError("KnowledgeFS transport request failed") from exc
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            raise KnowledgeFSUpstreamError("KnowledgeFS returned an invalid response") from exc

        if response.status_code != HTTPStatus.CREATED:
            raise KnowledgeFSUpstreamError(
                f"KnowledgeFS returned HTTP {response.status_code}",
                status_code=int(response.status_code),
            )
        if not isinstance(response.parsed, KnowledgeSpaceCreationResponse):
            raise KnowledgeFSUpstreamError("KnowledgeFS returned an invalid create response")
        if response.parsed.tenant_id != tenant_id:
            raise KnowledgeFSUpstreamError("KnowledgeFS returned data for another tenant")
        return response.parsed

    def _ensure_tenant(self, tenant_id: str) -> None:
        if tenant_id != self._expected_tenant_id:
            raise KnowledgeFSConfigurationError(
                "KNOWLEDGE_FS_STATIC_TENANT_ID does not match the current Dify workspace"
            )


def create_knowledge_space_service() -> KnowledgeSpaceService | None:
    """Build the optional single-workspace bridge from validated process config."""
    base_url = dify_config.KNOWLEDGE_FS_BASE_URL
    api_token = dify_config.KNOWLEDGE_FS_API_TOKEN
    tenant_id = dify_config.KNOWLEDGE_FS_STATIC_TENANT_ID
    if base_url is None and api_token is None and tenant_id is None:
        return None
    if base_url is None or api_token is None or tenant_id is None:
        raise KnowledgeFSConfigurationError("KnowledgeFS connection configuration is incomplete")

    timeout_seconds = float(dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS)
    token = api_token.get_secret_value()
    http_client = get_pooled_http_client(
        "knowledge-fs",
        lambda: httpx.Client(
            base_url=base_url,
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout_seconds,
        ),
    )
    generated_client = GeneratedKnowledgeFSClient(base_url=base_url).set_httpx_client(http_client)
    return KnowledgeSpaceService(generated_client, expected_tenant_id=tenant_id)
