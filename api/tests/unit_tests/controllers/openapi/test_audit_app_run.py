import logging
from typing import Protocol, cast

import pytest

from controllers.openapi._audit import EVENT_APP_RUN_OPENAPI, emit_app_run


class _AuditLogRecord(Protocol):
    audit: bool
    event: str
    app_id: str
    tenant_id: str
    caller_kind: str
    mode: str
    surface: str


def test_event_constant():
    assert EVENT_APP_RUN_OPENAPI == "app.run.openapi"


def test_emit_app_run_logs_with_audit_extra(caplog: pytest.LogCaptureFixture):
    with caplog.at_level(logging.INFO, logger="controllers.openapi._audit"):
        emit_app_run(
            app_id="app1",
            tenant_id="t1",
            caller_kind="account",
            mode="chat",
            surface="apps",
        )
    record = cast(_AuditLogRecord, next(r for r in caplog.records if r.message and "app.run.openapi" in r.message))
    assert record.audit is True
    assert record.event == EVENT_APP_RUN_OPENAPI
    assert record.app_id == "app1"
    assert record.tenant_id == "t1"
    assert record.caller_kind == "account"
    assert record.mode == "chat"
    assert record.surface == "apps"
