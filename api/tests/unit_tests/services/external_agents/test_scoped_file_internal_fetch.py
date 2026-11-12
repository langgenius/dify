"""Scoped upload MACs defer native reads to their authoritative public delivery owner."""

import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from flask import has_app_context

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from core.file import remote_fetcher
from core.tools.signature import verify_tool_file_signature
from graphon.file import helpers as file_helpers
from models.enums import CreatorUserRole
from services.file_service import FileUploadActor
from tests.unit_tests.services.external_agents.test_scoped_file_urls import FileURLs, input_link, urls

__all__ = ["urls"]


def native_without_app_context(url: str) -> httpx.Response | None:
    """Use a real fresh thread; unit tests normally inherit an autouse Flask context."""
    assert not has_app_context()
    return remote_fetcher._resolve_dify_signed_file_url("GET", url)


def observe_native_reads(urls: FileURLs, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Count native reads while delegating to the actual storage implementation."""
    original = urls.storage.load_once
    calls: list[str] = []

    def load_once(filename: str) -> bytes:
        calls.append(filename)
        return original(filename)

    monkeypatch.setattr(urls.storage, "load_once", load_once)
    return calls


def test_scoped_native_url_without_composition_defers_to_authoritative_public_reader(
    urls: FileURLs, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A fresh thread cannot reinterpret the scoped MAC as an ordinary local capability.

    The normal HTTP path owns scope verification; real HTTPS fallback is covered
    by dev acceptance, not fabricated inside this local-resolution unit test.
    """
    monkeypatch.setattr("core.db.session_factory._session_maker", urls.sessions)
    monkeypatch.setattr(remote_fetcher, "storage", urls.storage)
    link = input_link(urls, urls.input())
    calls = observe_native_reads(urls, monkeypatch)
    with ThreadPoolExecutor(max_workers=1) as pool:
        response = pool.submit(native_without_app_context, link.url).result(timeout=10)
    assert response is None
    assert calls == []


def test_ordinary_native_url_keeps_real_byte_delivery_without_flask_context(
    urls: FileURLs, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Ordinary uploads preserve their existing signed capability, without Test leases."""
    monkeypatch.setattr("core.db.session_factory._session_maker", urls.sessions)
    monkeypatch.setattr(remote_fetcher, "storage", urls.storage)
    uploaded = urls.files.upload_file_for_actor(
        actor=FileUploadActor(id=urls.context.account_id, creator_role=CreatorUserRole.ACCOUNT),
        resource_tenant_id=urls.context.active_workspace_id,
        filename="ordinary.txt",
        content=b"ordinary owned bytes",
        mimetype="text/plain",
    )
    calls = observe_native_reads(urls, monkeypatch)
    with ThreadPoolExecutor(max_workers=1) as pool:
        response = pool.submit(native_without_app_context, uploaded.source_url).result(timeout=10)
    assert response is not None
    assert response.status_code == 200
    assert response.content == b"ordinary owned bytes"
    assert len(calls) == 1


def test_scoped_upload_mac_is_not_accepted_by_ordinary_preview_verifiers(urls: FileURLs) -> None:
    """A new scoped capability cannot be replayed in an old reader lacking its gate.

    Public scoped delivery still succeeds, while the unchanged ordinary File
    and Tool/Datasource HMAC verifiers must not authenticate these claims.
    """
    link = input_link(urls, urls.input())
    query = parse_qs(urlsplit(link.url).query)
    timestamp, nonce, signature = (query[name][0] for name in ("timestamp", "nonce", "sign"))
    assert urls.read(link) == (200, b"input owned bytes")
    assert not file_helpers.verify_file_signature(
        upload_file_id=link.file_id, timestamp=timestamp, nonce=nonce, sign=signature
    )
    assert not verify_tool_file_signature(link.file_id, timestamp, nonce, signature)
    legacy_datasource = remote_fetcher._parse_signed_file_path(f"/files/datasources/{link.file_id}.txt")
    assert legacy_datasource is not None
    assert not remote_fetcher._verify_signed_file_url(
        signed_file_url=legacy_datasource, timestamp=timestamp, nonce=nonce, sign=signature
    )


@pytest.mark.parametrize("method", ["GET", "HEAD"])
@pytest.mark.parametrize("boundary", ["generation", "page_leave"])
@pytest.mark.parametrize("path_kind", ["upload", "datasource"])
def test_scoped_mac_defers_native_reads_and_public_reader_rechecks_lifecycle(
    urls: FileURLs,
    monkeypatch: pytest.MonkeyPatch,
    method: Literal["GET", "HEAD"],
    boundary: str,
    path_kind: str,
) -> None:
    """Use real SQLite, native storage, signer and the authoritative public controller.

    A normal same-tenant account file scope is deliberately present: its generic
    file permission cannot replace the more restrictive Test page/generation
    capability. No business receipt or successful Invocation is synthesized.
    """
    monkeypatch.setattr("core.db.session_factory._session_maker", urls.sessions)
    monkeypatch.setattr(remote_fetcher, "storage", urls.storage)
    lease = urls.input()
    link = input_link(urls, lease)
    calls = observe_native_reads(urls, monkeypatch)
    fetch_url = (
        link.url
        if path_kind == "upload"
        else urlsplit(link.url)._replace(path=f"/files/datasources/{link.file_id}.txt").geturl()
    )
    scope = FileAccessScope(
        tenant_id=urls.context.active_workspace_id,
        user_id=urls.context.account_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    with urls.app.app_context(), bind_file_access_scope(scope):
        public_before_status, public_before_bytes = urls.read(link)
        assert (public_before_status, public_before_bytes) == (200, b"input owned bytes")
        before = remote_fetcher._resolve_dify_signed_file_url(method, fetch_url)
        # The independent MAC domain prevents every legacy shortcut/alias from
        # authenticating scoped claims. No kernel-to-service dependency is needed.
        assert before is None
        assert calls == []
        if boundary == "generation":
            urls.services.external_agents.assets.update_info(
                urls.context, agent_id=urls.agent_id, expected_revision=1, changes={"description": "Actual edit"}
            )
        else:
            urls.services.external_agents.retention.leave_test_page(
                tenant_id=urls.context.active_workspace_id,
                actor_id=urls.context.account_id,
                page_session_id="page",
                now=datetime.now(UTC),
            )
        public_status, _ = urls.read(link)
        assert public_status == 404
        after = remote_fetcher._resolve_dify_signed_file_url(method, fetch_url)
        assert after is None
        assert calls == []
        evidence = {
            "method": method,
            "boundary": boundary,
            "path_kind": path_kind,
            "public_before_status": public_before_status,
            "public_before_sha256": hashlib.sha256(public_before_bytes).hexdigest(),
            "private_before_deferred_to_public": True,
            "public_after_status": public_status,
            "private_after_deferred_to_public": True,
            "native_read_count": len(calls),
            "real_sql_native_storage": True,
            "business_invocation_created": False,
        }
        destination = os.environ.get("BYOA_INTERNAL_FASTPATH_PROBE_OUTPUT")
        if destination:
            path = Path(destination)
            previous = json.loads(path.read_text()) if path.exists() else []
            path.write_text(json.dumps([*previous, evidence], indent=2) + "\n")
