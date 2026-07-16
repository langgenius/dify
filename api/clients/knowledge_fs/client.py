"""Dify adapter around the OpenAPI-generated KnowledgeFS client.

The wire request, response, and endpoint definitions under ``generated/`` are
projected from the KnowledgeFS-owned OpenAPI artifact. This module only keeps
the local protocol and normalizes transport and upstream errors for Dify.

KnowledgeFS derives tenant identity from a short-lived bearer credential that
is signed for each operation. The credential is attached through request-local
``httpx.Auth`` context, never through shared client headers, so pooled clients
remain safe to reuse across concurrent Dify tenants. Every accepted upstream
response is bounded before the generated client parses it, and successful
responses must echo the request tenant so upstream failures fail closed at the
Dify boundary.
"""

from __future__ import annotations

import logging
from datetime import datetime
from threading import Lock
from typing import Protocol

import httpx

from clients.knowledge_fs.credentials import (
    KnowledgeFSCredentialProvider,
    KnowledgeFSRequestAuth,
    use_knowledge_fs_credential,
)
from clients.knowledge_fs.errors import (
    KnowledgeFSHTTPError,
    KnowledgeFSTimeoutError,
    KnowledgeFSTransportError,
    KnowledgeFSValidationError,
)
from clients.knowledge_fs.generated.api.knowledge_spaces import (
    create_knowledge_space,
    list_knowledge_spaces,
)
from clients.knowledge_fs.generated.client import Client as GeneratedKnowledgeFSClient
from clients.knowledge_fs.generated.models import (
    CreateKnowledgeSpace,
    ErrorResponse,
    KnowledgeSpace,
    KnowledgeSpaceCreationResponse,
    KnowledgeSpaceList,
)
from clients.knowledge_fs.generated.types import UNSET

logger = logging.getLogger(__name__)

MAX_KNOWLEDGE_FS_RESPONSE_BYTES = 1024 * 1024
_RESPONSE_LIMIT_HOOK_LOCK = Lock()


def _read_bounded_response(response: httpx.Response) -> None:
    """Buffer at most the allowed decoded bytes before generated parsing runs."""
    content_encoding = response.headers.get("Content-Encoding", "identity").strip().lower()
    if content_encoding != "identity":
        raise KnowledgeFSValidationError(detail="KnowledgeFS response uses an unsupported content encoding")

    if hasattr(response, "_content"):
        if len(response.content) > MAX_KNOWLEDGE_FS_RESPONSE_BYTES:
            raise KnowledgeFSValidationError(
                detail=f"KnowledgeFS response exceeds {MAX_KNOWLEDGE_FS_RESPONSE_BYTES} bytes"
            )
        return

    content = bytearray()
    for chunk in response.iter_bytes():
        if len(chunk) > MAX_KNOWLEDGE_FS_RESPONSE_BYTES - len(content):
            raise KnowledgeFSValidationError(
                detail=f"KnowledgeFS response exceeds {MAX_KNOWLEDGE_FS_RESPONSE_BYTES} bytes"
            )
        content.extend(chunk)

    # httpx has no public API for supplying content consumed by a response hook.
    # Caching it here lets later hooks and the generated parser read the bounded body normally.
    response._content = bytes(content)


def _install_response_limit(http_client: httpx.Client) -> None:
    """Prepend the bounded reader without replacing caller-provided event hooks."""
    with _RESPONSE_LIMIT_HOOK_LOCK:
        response_hooks = http_client.event_hooks["response"]
        if _read_bounded_response not in response_hooks:
            response_hooks.insert(0, _read_bounded_response)


class KnowledgeFSClient(Protocol):
    """Operations consumed by the first Dataset 2.0 Console slice."""

    def list_knowledge_spaces(
        self,
        *,
        limit: int,
        cursor: str | None,
        tenant_id: str,
        user_id: str,
    ) -> KnowledgeSpaceList:
        """List spaces authorized by the resolved KnowledgeFS credential."""

    def create_knowledge_space(
        self,
        *,
        idempotency_key: str,
        name: str,
        description: str | None,
        tenant_id: str,
        user_id: str,
    ) -> KnowledgeSpace:
        """Create a space authorized by the resolved KnowledgeFS credential."""


class OpenAPIKnowledgeFSClient:
    """Sign each operation and normalize generated-client integration errors."""

    client: GeneratedKnowledgeFSClient
    credential_provider: KnowledgeFSCredentialProvider

    def __init__(
        self,
        *,
        http_client: httpx.Client,
        credential_provider: KnowledgeFSCredentialProvider,
    ) -> None:
        self.credential_provider = credential_provider
        if not isinstance(http_client.auth, KnowledgeFSRequestAuth):
            http_client.auth = KnowledgeFSRequestAuth()
        _install_response_limit(http_client)
        self.client = GeneratedKnowledgeFSClient(
            base_url=str(http_client.base_url),
            raise_on_unexpected_status=False,
        ).set_httpx_client(http_client)

    def list_knowledge_spaces(
        self,
        *,
        limit: int,
        cursor: str | None,
        tenant_id: str,
        user_id: str,
    ) -> KnowledgeSpaceList:
        """Call the generated ``listKnowledgeSpaces`` operation."""
        logger.debug("Listing KnowledgeFS spaces", extra={"tenant_id": tenant_id, "user_id": user_id})
        credential = self.credential_provider.issue(
            tenant_id=tenant_id,
            subject_id=user_id,
            scope="knowledge-spaces:read",
        )
        try:
            with use_knowledge_fs_credential(credential):
                response = list_knowledge_spaces.sync_detailed(
                    client=self.client,
                    limit=limit,
                    cursor=cursor if cursor is not None else UNSET,
                )
        except httpx.TimeoutException as exc:
            raise KnowledgeFSTimeoutError(str(exc)) from exc
        except httpx.HTTPError as exc:
            raise KnowledgeFSTransportError(str(exc)) from exc
        except (KeyError, TypeError, ValueError) as exc:
            raise KnowledgeFSValidationError(detail=str(exc)) from exc

        if response.status_code != 200:
            raise self._http_error(response.status_code, response.parsed)
        if not isinstance(response.parsed, KnowledgeSpaceList):
            raise KnowledgeFSValidationError(detail="listKnowledgeSpaces returned an invalid success body")
        self._validate_list(response.parsed, expected_tenant_id=tenant_id)
        return response.parsed

    def create_knowledge_space(
        self,
        *,
        idempotency_key: str,
        name: str,
        description: str | None,
        tenant_id: str,
        user_id: str,
    ) -> KnowledgeSpace:
        """Call the generated ``createKnowledgeSpace`` operation."""
        logger.debug("Creating a KnowledgeFS space", extra={"tenant_id": tenant_id, "user_id": user_id})
        body = CreateKnowledgeSpace(
            idempotency_key=idempotency_key,
            name=name,
            description=description if description is not None else UNSET,
        )
        credential = self.credential_provider.issue(
            tenant_id=tenant_id,
            subject_id=user_id,
            scope="knowledge-spaces:write",
        )
        try:
            with use_knowledge_fs_credential(credential):
                response = create_knowledge_space.sync_detailed(client=self.client, body=body)
        except httpx.TimeoutException as exc:
            raise KnowledgeFSTimeoutError(str(exc)) from exc
        except httpx.HTTPError as exc:
            raise KnowledgeFSTransportError(str(exc)) from exc
        except (KeyError, TypeError, ValueError) as exc:
            raise KnowledgeFSValidationError(detail=str(exc)) from exc

        if response.status_code != 201:
            raise self._http_error(response.status_code, response.parsed)
        if not isinstance(response.parsed, KnowledgeSpaceCreationResponse):
            raise KnowledgeFSValidationError(detail="createKnowledgeSpace returned an invalid success body")
        space = KnowledgeSpace(
            created_at=response.parsed.created_at,
            description=response.parsed.description,
            icon_ref=response.parsed.icon_ref,
            id=response.parsed.id,
            name=response.parsed.name,
            revision=response.parsed.revision,
            slug=response.parsed.slug,
            tenant_id=response.parsed.tenant_id,
            updated_at=response.parsed.updated_at,
        )
        self._validate_space(space)
        self._validate_space_tenant(space, expected_tenant_id=tenant_id)
        return space

    @staticmethod
    def _http_error(status_code: int, parsed: object) -> KnowledgeFSHTTPError:
        detail = parsed.error[:500] if isinstance(parsed, ErrorResponse) and isinstance(parsed.error, str) else None
        return KnowledgeFSHTTPError(status_code=int(status_code), detail=detail)

    @classmethod
    def _validate_list(cls, result: KnowledgeSpaceList, *, expected_tenant_id: str) -> None:
        if not isinstance(result.items, list):
            raise KnowledgeFSValidationError(detail="KnowledgeSpaceList.items must be a list")
        if result.next_cursor is not UNSET and not isinstance(result.next_cursor, str):
            raise KnowledgeFSValidationError(detail="KnowledgeSpaceList.nextCursor must be a string")
        for space in result.items:
            if not isinstance(space, KnowledgeSpace):
                raise KnowledgeFSValidationError(detail="KnowledgeSpaceList.items contains an invalid item")
            cls._validate_space(space)
            cls._validate_space_tenant(space, expected_tenant_id=expected_tenant_id)

    @staticmethod
    def _validate_space(space: KnowledgeSpace) -> None:
        string_fields: tuple[tuple[str, object], ...] = (
            ("id", space.id),
            ("tenantId", space.tenant_id),
            ("name", space.name),
            ("slug", space.slug),
        )
        invalid_string_field = next((name for name, value in string_fields if not isinstance(value, str)), None)
        if invalid_string_field is not None:
            raise KnowledgeFSValidationError(detail=f"KnowledgeSpace.{invalid_string_field} must be a string")
        if space.description is not UNSET and not isinstance(space.description, str):
            raise KnowledgeFSValidationError(detail="KnowledgeSpace.description must be a string")
        if isinstance(space.revision, bool) or not isinstance(space.revision, int) or space.revision <= 0:
            raise KnowledgeFSValidationError(detail="KnowledgeSpace.revision must be a positive integer")
        if not isinstance(space.created_at, datetime) or not isinstance(space.updated_at, datetime):
            raise KnowledgeFSValidationError(detail="KnowledgeSpace timestamps must be datetimes")

    @staticmethod
    def _validate_space_tenant(space: KnowledgeSpace, *, expected_tenant_id: str) -> None:
        if space.tenant_id != expected_tenant_id:
            raise KnowledgeFSValidationError(detail="KnowledgeSpace.tenantId does not match the requested tenant")
