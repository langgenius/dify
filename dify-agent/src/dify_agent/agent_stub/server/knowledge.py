"""Async, bounded knowledge transport shared by embedded and standalone Stub."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import io
import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from uuid import uuid4

import httpx
from redis.exceptions import RedisError
from PIL import Image, UnidentifiedImageError

from dify_agent.agent_stub.server.tokens.agent_stub import AgentStubPrincipal
from dify_agent.layers.knowledge_fs.session import KnowledgeFsDelivery, KnowledgeFsSession, KnowledgeFsSessionStore
from dify_agent.protocol.knowledge_fs import (
    KNOWLEDGE_FS_COMMAND_TIMEOUT,
    KNOWLEDGE_FS_MAX_RESULT_BYTES,
    KnowledgeFsCitation,
    KnowledgeFsCommand,
    KnowledgeFsCommandResult,
    KnowledgeFsError,
    KnowledgeFsPreparedRequest,
    KnowledgeFsPrepareRequest,
)

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class AgentStubKnowledgeHandler:
    get_store: Callable[[], KnowledgeFsSessionStore]
    get_http_client: Callable[[], httpx.AsyncClient]
    inner_api_url: str
    inner_api_key: str

    async def execute(
        self,
        principal: AgentStubPrincipal,
        command: KnowledgeFsCommand,
        disconnected: Callable[[], Awaitable[bool]] | None = None,
    ) -> KnowledgeFsCommandResult:
        store = self.get_store()
        session = await store.load(principal.session_id or "")
        if session.execution_context != principal.execution_context:
            raise KnowledgeFsError(
                "KNOWLEDGE_SCOPE_MISMATCH", "Knowledge session does not match the execution context.", 403
            )
        await store.reserve(session, str(command.command_id))
        task = asyncio.create_task(self._execute(session, command))

        async def monitor() -> None:
            while True:
                await asyncio.sleep(0.5)
                await store.load(session.id)
                if disconnected and await disconnected():
                    raise KnowledgeFsError(
                        "KNOWLEDGE_CLIENT_DISCONNECTED", "Knowledge command caller disconnected.", 409
                    )

        watchdog = asyncio.create_task(monitor())
        try:
            async with asyncio.timeout(KNOWLEDGE_FS_COMMAND_TIMEOUT):
                done, _ = await asyncio.wait({task, watchdog}, return_when=asyncio.FIRST_COMPLETED)
                if watchdog in done:
                    await watchdog
                delivery = await task
                # Closing the run or losing its lease while upstream was in flight
                # must prevent stale evidence from being returned or persisted.
                await store.deliver(session, delivery)
                return delivery.result
        except TimeoutError as exc:
            raise KnowledgeFsError("KNOWLEDGE_TIMEOUT", "Knowledge command exceeded 60 seconds.", 504) from exc
        finally:
            task.cancel()
            watchdog.cancel()
            await asyncio.gather(task, watchdog, return_exceptions=True)
            try:
                await store.release(session, str(command.command_id))
            except RedisError:
                # The reservation retains its worst-case charge and expires.
                # Do not replace a cancellation/authorization error with cleanup.
                logger.warning("Knowledge budget release failed; reservation remains charged")

    async def _prepare(
        self, session: KnowledgeFsSession, command: KnowledgeFsCommand, citation: KnowledgeFsCitation | None
    ) -> KnowledgeFsPreparedRequest:
        request = KnowledgeFsPrepareRequest(
            execution_context=session.execution_context,
            bindings=session.bindings,
            agent_supports_vision=session.agent_supports_vision,
            command=command,
            citation=citation,
        )
        payload, _ = await self._fetch(
            url=f"{self.inner_api_url.rstrip('/')}/inner/api/agent/knowledge/prepare",
            method="POST",
            headers={"X-Inner-Api-Key": self.inner_api_key},
            payload=request.model_dump(mode="json", exclude_unset=True),
            max_bytes=65536,
        )
        try:
            return KnowledgeFsPreparedRequest.model_validate_json(payload)
        except ValueError as exc:
            raise KnowledgeFsError(
                "KNOWLEDGE_PROTOCOL_MISMATCH", "API does not support the knowledge CLI protocol.", 502
            ) from exc

    async def _execute(self, session: KnowledgeFsSession, command: KnowledgeFsCommand) -> KnowledgeFsDelivery:
        citation = await self.get_store().citation(session, command.receipt_id) if command.receipt_id else None
        # A media read first verifies the current artifact under a new capability.
        # Asset endpoints themselves enforce candidate/document scope as well.
        if command.command == "image":
            manifest_command = KnowledgeFsCommand(
                command_id=command.command_id, command="images", space=command.space, receipt_id=command.receipt_id
            )
            manifest_plan = await self._prepare(session, manifest_command, citation)
            manifest = await self._json(manifest_plan)
            self._assert_artifact(manifest, citation)
            items = manifest.get("items")
            if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
                raise KnowledgeFsError("KNOWLEDGE_PROTOCOL_MISMATCH", "Invalid image manifest.", 502)
            item = next((item for item in items if item.get("id") == command.item_id), None)
            if item is None or item.get("modality") not in {"image", "page"}:
                raise KnowledgeFsError(
                    "KNOWLEDGE_IMAGE_NOT_FOUND", "Choose an image item from the evidence manifest.", 404
                )
        plan = await self._prepare(session, command, citation)
        if plan.response_kind == "local":
            return KnowledgeFsDelivery(
                result=KnowledgeFsCommandResult(
                    command_id=command.command_id,
                    command=command.command,
                    data=plan.data,
                )
            )
        if plan.response_kind == "image":
            data, content_type = await self._fetch_plan(plan)
            image_bytes, media_type = await asyncio.to_thread(_validate_thumbnail, data, content_type)
            return KnowledgeFsDelivery(
                result=KnowledgeFsCommandResult(
                    command_id=command.command_id,
                    command=command.command,
                    trace_id=plan.trace_id,
                    data={
                        "image_queued_for_model": True,
                        "item_id": command.item_id,
                        "sha256": hashlib.sha256(image_bytes).hexdigest(),
                    },
                    citations=[citation] if citation else [],
                ),
                image_base64=base64.b64encode(image_bytes).decode(),
                image_media_type=media_type,
            )
        raw = await self._json(plan)
        try:
            result = project_result(command, plan, raw, citation)
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise KnowledgeFsError(
                "KNOWLEDGE_PROTOCOL_MISMATCH", "KnowledgeFS returned invalid evidence.", 502
            ) from exc
        if len(result.model_dump_json().encode()) > KNOWLEDGE_FS_MAX_RESULT_BYTES:
            raise KnowledgeFsError(
                "KNOWLEDGE_RESULT_TOO_LARGE",
                "Result exceeds the output budget; narrow the path/query or lower --limit.",
                413,
            )
        return KnowledgeFsDelivery(result=result)

    @staticmethod
    def _assert_artifact(raw: dict, citation: KnowledgeFsCitation | None) -> None:
        if (
            citation is None
            or raw.get("artifactHash") != citation.artifact_hash
            or raw.get("documentAssetId") != citation.document_asset_id
        ):
            raise KnowledgeFsError("KNOWLEDGE_EVIDENCE_STALE", "Document changed; search or open it again.", 409)

    async def _json(self, plan: KnowledgeFsPreparedRequest) -> dict:
        data, _ = await self._fetch_plan(plan)
        try:
            raw = json.loads(data)
            if not isinstance(raw, dict):
                raise ValueError("not an object")
            return raw
        except (ValueError, RecursionError) as exc:
            raise KnowledgeFsError(
                "KNOWLEDGE_PROTOCOL_MISMATCH", "KnowledgeFS returned an invalid response.", 502
            ) from exc

    async def _fetch_plan(self, plan: KnowledgeFsPreparedRequest) -> tuple[bytes, str]:
        if not plan.url:
            raise KnowledgeFsError("KNOWLEDGE_PROTOCOL_MISMATCH", "Missing prepared operation.", 502)
        return await self._fetch(
            url=plan.url,
            method=plan.method,
            headers=plan.headers,
            query=plan.query,
            payload=plan.payload,
            max_bytes=plan.max_response_bytes,
        )

    async def _fetch(
        self,
        *,
        url: str,
        method: str,
        headers: dict[str, str],
        max_bytes: int,
        query: dict | None = None,
        payload: dict | None = None,
    ) -> tuple[bytes, str]:
        try:
            async with self.get_http_client().stream(
                method,
                url,
                headers={**headers, "Accept-Encoding": "identity"},
                params=query,
                json=payload,
                follow_redirects=False,
                timeout=KNOWLEDGE_FS_COMMAND_TIMEOUT,
            ) as response:
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise KnowledgeFsError(
                        "KNOWLEDGE_PROTOCOL_MISMATCH", "Compressed knowledge responses are unsupported.", 502
                    )
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(data) + len(chunk) > max_bytes:
                        raise KnowledgeFsError(
                            "KNOWLEDGE_RESPONSE_TOO_LARGE", "KnowledgeFS response exceeds the byte limit.", 413
                        )
                    data.extend(chunk)
                if response.status_code >= 300:
                    # Never echo raw upstream errors (they can contain URLs or
                    # secrets). Keep only a bounded machine-readable error code.
                    code = "KNOWLEDGE_UPSTREAM_ERROR"
                    with contextlib.suppress(ValueError, AttributeError):
                        candidate = json.loads(data).get("code", "")
                        if isinstance(candidate, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{1,79}", candidate):
                            code = candidate
                    message = {
                        401: "Knowledge authorization expired; retry in a new shell call.",
                        403: "Knowledge access was denied or revoked.",
                        404: "Knowledge resource is unavailable.",
                        409: "Knowledge state changed; refresh the evidence or configuration.",
                        422: "Query modality or arguments are unsupported by this knowledge space.",
                        429: "Knowledge provider or run budget is exhausted.",
                    }.get(response.status_code, "Knowledge service could not complete this command.")
                    raise KnowledgeFsError(code, message, response.status_code)
                return bytes(data), response.headers.get("content-type", "").split(";")[0]
        except httpx.TimeoutException as exc:
            raise KnowledgeFsError("KNOWLEDGE_TIMEOUT", "Knowledge service request timed out.", 504) from exc
        except httpx.HTTPError as exc:
            raise KnowledgeFsError("KNOWLEDGE_UNAVAILABLE", "Knowledge service is unavailable.", 502) from exc


def _validate_thumbnail(data: bytes, content_type: str) -> tuple[bytes, str]:
    # Verify headers/dimensions before decoding; compressed size is not a raster
    # memory bound. No SVG, animation or external references reach the model.
    try:
        with Image.open(io.BytesIO(data)) as image:
            if (
                image.format not in {"JPEG", "PNG", "WEBP"}
                or image.width * image.height > 4_000_000
                or max(image.size) > 4096
            ):
                raise ValueError("unsafe dimensions or encoding")
            if getattr(image, "n_frames", 1) != 1:
                raise ValueError("animated image")
            media_type = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[image.format]
            if content_type != media_type:
                raise ValueError("content type mismatch")
            image.verify()
        return data, media_type
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise KnowledgeFsError(
            "KNOWLEDGE_IMAGE_UNSAFE", "Image exceeds safe dimensions or has an unsupported encoding.", 413
        ) from exc


def _clip(value, limit: int = 4096):
    return value[:limit] if isinstance(value, str) else value


def _public_fs(value, depth=0):
    if depth > 16:
        raise KnowledgeFsError("KNOWLEDGE_RESPONSE_TOO_DEEP", "Knowledge result nesting exceeds the limit.", 413)
    if isinstance(value, list):
        return [_public_fs(item, depth + 1) for item in value]
    if not isinstance(value, dict):
        return value
    # Filesystem metadata can contain parser/provider internals; do not forward
    # arbitrary metadata, permissionScope, object keys or URL-bearing manifests.
    allowed = {
        "items",
        "root",
        "children",
        "matches",
        "name",
        "path",
        "oldPath",
        "newPath",
        "kind",
        "resourceType",
        "targetId",
        "nodeId",
        "segmentId",
        "sha256",
        "version",
        "parserStatus",
        "sizeBytes",
        "contentType",
        "text",
        "snippet",
        "startOffset",
        "endOffset",
        "truncated",
        "nextCursor",
        "mode",
        "operations",
        "stats",
        "equal",
        "insert",
        "delete",
        "newStart",
        "newEnd",
        "oldStart",
        "oldEnd",
        "consistencyClass",
        "preview",
    }
    return {key: _public_fs(item, depth + 1) for key, item in value.items() if key in allowed}


def _citation(plan, raw: dict, node_id: str) -> KnowledgeFsCitation:
    if plan.binding is None:
        raise KnowledgeFsError("KNOWLEDGE_PROTOCOL_MISMATCH", "Missing evidence scope.", 502)
    return KnowledgeFsCitation(
        id=f"kfs_{uuid4().hex}",
        control_space_id=plan.binding.control_space_id,
        space_name=plan.binding.name,
        node_id=node_id,
        artifact_hash=raw["artifactHash"],
        document_asset_id=raw["documentAssetId"],
        document_version=raw.get("documentVersion"),
        parse_artifact_id=raw.get("parseArtifactId"),
        document_title=raw.get("documentTitle"),
        page_number=raw.get("pageNumber"),
        section_path=raw.get("sectionPath", []),
        start_offset=raw.get("startOffset"),
        end_offset=raw.get("endOffset"),
    )


def project_result(command, plan, raw, previous=None) -> KnowledgeFsCommandResult:
    citations = []
    if command.command == "search":
        if raw.get("mode") != "fast" or not isinstance(raw.get("items"), list):
            raise KnowledgeFsError("KNOWLEDGE_PROTOCOL_MISMATCH", "Expected evidence-only fast retrieval.", 502)
        items = []
        for index, item in enumerate(raw["items"][: command.limit]):
            citation = _citation(plan, item["citation"], item["nodeId"])
            citations.append(citation)
            items.append(
                {
                    "rank": index + 1,
                    "node_id": citation.node_id,
                    "receipt_id": citation.id,
                    "text": _clip(item.get("text")),
                    "text_truncated": len(item.get("text") or "") > 4096,
                    "sources": item.get("sources", []),
                }
            )
        data = {
            "items": items,
            "has_more": len(raw["items"]) > command.limit,
            "ranking_scope": "this_space_only",
            "degradation_flags": raw.get("metrics", {}).get("degradationFlags", []),
        }
    elif command.command == "open":
        citation = _citation(plan, raw["citation"], raw["node"]["id"])
        if previous and (
            (citation.node_id, citation.document_asset_id, citation.artifact_hash)
            != (previous.node_id, previous.document_asset_id, previous.artifact_hash)
            or (previous.parse_artifact_id is not None and citation.parse_artifact_id != previous.parse_artifact_id)
            or (previous.document_version is not None and citation.document_version != previous.document_version)
        ):
            raise KnowledgeFsError("KNOWLEDGE_EVIDENCE_STALE", "Document changed; search again.", 409)
        if previous:
            citation = citation.model_copy(
                update={
                    "id": previous.id,
                    "document_version": citation.document_version or previous.document_version,
                    "document_title": citation.document_title or previous.document_title,
                }
            )
        citations.append(citation)
        text = raw["node"]["text"]
        data = {
            "node_id": citation.node_id,
            "receipt_id": citation.id,
            "text": _clip(text, 16000),
            "text_truncated": len(text) > 16000,
            "kind": raw["node"].get("kind"),
        }
    elif command.command == "images":
        AgentStubKnowledgeHandler._assert_artifact(raw, previous)
        offset = 0
        if command.cursor:
            try:
                fingerprint, position = command.cursor.rsplit(":", 1)
                offset = int(position)
                if fingerprint != raw["artifactHash"] or offset < 0 or offset > len(raw["items"]):
                    raise ValueError("invalid cursor")
            except ValueError as exc:
                raise KnowledgeFsError("KNOWLEDGE_CURSOR_INVALID", "Image cursor is stale or invalid.") from exc
        items = raw["items"][offset : offset + command.limit]
        data = {
            "items": [
                {
                    key: _clip(item.get(key))
                    for key in (
                        "id",
                        "modality",
                        "title",
                        "caption",
                        "ocrText",
                        "pageNumber",
                        "textPreview",
                        "parseElementId",
                    )
                }
                for item in items
            ],
            "next_cursor": f"{raw['artifactHash']}:{offset + len(items)}"
            if offset + len(items) < len(raw["items"])
            else None,
        }
        citations = [previous]
    elif command.command == "capabilities":
        # Space owns retrieval/embedding capabilities; do not leak credentials or
        # expose an Agent planner configuration through this settings response.
        capabilities = raw.get("capabilities", {})
        data = {
            "capabilities": {key: capabilities[key] for key in ("query",) if isinstance(capabilities.get(key), bool)},
            "read_only": True,
            "search_mode": "fast",
            "paths": ["/knowledge"],
        }
    else:
        data = _public_fs(raw)
        if command.command == "cat" and str(raw.get("contentType", "")).lower() in {
            "application/json",
            "application/octet-stream",
        }:
            raise KnowledgeFsError(
                "KNOWLEDGE_MANIFEST_RESTRICTED",
                "Use images/open for evidence manifests; raw artifacts are not exposed.",
                403,
            )
    return KnowledgeFsCommandResult(
        command_id=command.command_id, command=command.command, data=data, citations=citations, trace_id=plan.trace_id
    )
