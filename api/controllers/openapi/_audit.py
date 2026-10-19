"""Audit emission for openapi app-run endpoints.

Pattern: logger.info with extra={"audit": True, "event": "app.run.openapi", ...}
matches the existing oauth_device convention. The EE OTel exporter consults
its own allowlist to decide whether to ship the line.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

EVENT_APP_RUN_OPENAPI = "app.run.openapi"
EVENT_OPENAPI_WRONG_SURFACE_DENIED = "openapi.wrong_surface_denied"


def emit_app_run(
    *,
    app_id: str,
    tenant_id: str,
    caller_kind: str,
    mode: str,
    surface: str,
) -> None:
    logger.info(
        "audit: %s app_id=%s tenant_id=%s caller_kind=%s mode=%s surface=%s",
        EVENT_APP_RUN_OPENAPI,
        app_id,
        tenant_id,
        caller_kind,
        mode,
        surface,
        extra={
            "audit": True,
            "event": EVENT_APP_RUN_OPENAPI,
            "app_id": app_id,
            "tenant_id": tenant_id,
            "caller_kind": caller_kind,
            "mode": mode,
            "surface": surface,
        },
    )


def emit_wrong_surface(
    *,
    subject_type: str | None,
    attempted_path: str,
    client_id: str | None,
    token_id: str | None,
) -> None:
    logger.warning(
        "audit: %s subject_type=%s attempted_path=%s",
        EVENT_OPENAPI_WRONG_SURFACE_DENIED,
        subject_type,
        attempted_path,
        extra={
            "audit": True,
            "event": EVENT_OPENAPI_WRONG_SURFACE_DENIED,
            "subject_type": subject_type,
            "attempted_path": attempted_path,
            "client_id": client_id,
            "token_id": token_id,
        },
    )


def emit_personal_request(
    *,
    token_id: str,
    account_id: str,
    operation: str,
    target_route: str,
    target_ids: dict[str, str],
    http_status: int,
    streaming: bool,
    trace_id: str | None,
) -> None:
    """Audit authenticated PAT requests without headers, bodies or exception text.

    A successful SSE response records admission only, not execution completion.
    trace_id is absent when no server trace was assigned.
    """
    outcome = (
        "failed"
        if http_status >= 500
        else "denied"
        if http_status >= 400
        else "stream_opened"
        if streaming
        else "succeeded"
    )
    logger.info(
        "audit: pat.request.openapi token_id=%s account_id=%s operation=%s target=%s ids=%s outcome=%s status=%s",
        token_id,
        account_id,
        operation,
        target_route,
        target_ids,
        outcome,
        http_status,
        extra={
            "audit": True,
            "event": "pat.request.openapi",
            "token_id": token_id,
            "account_id": account_id,
            "operation": operation,
            "target_route": target_route,
            "target_ids": target_ids,
            "outcome": outcome,
            "http_status": http_status,
            "trace_id": trace_id,
        },
    )
