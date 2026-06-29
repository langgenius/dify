"""Unit tests for the agent output ToolFile rebacker (ENG-593)."""

from __future__ import annotations

from collections.abc import Generator

import pytest
from sqlalchemy import delete

from core.db.session_factory import session_factory
from core.workflow.file_reference import resolve_file_record_id
from core.workflow.nodes.agent_v2.output_file_rebacker import reback_tool_file_output
from graphon.file import FileTransferMethod, FileType
from models.tools import ToolFile

TENANT = "11111111-1111-1111-1111-111111111111"


@pytest.fixture(autouse=True)
def _tables() -> Generator[None, None, None]:
    engine = session_factory.get_session_maker().kw["bind"]
    ToolFile.__table__.create(bind=engine, checkfirst=True)
    yield
    with session_factory.create_session() as session:
        session.execute(delete(ToolFile))
        session.commit()


def _seed(*, mimetype: str = "application/pdf", name: str = "report.pdf", size: int = 42) -> str:
    tool_file = ToolFile(
        user_id="22222222-2222-2222-2222-222222222222",
        tenant_id=TENANT,
        conversation_id=None,
        file_key=f"tools/{TENANT}/{name}",
        mimetype=mimetype,
        name=name,
        size=size,
    )
    with session_factory.create_session() as session:
        session.add(tool_file)
        session.commit()
        return tool_file.id


def test_reback_resolves_tenant_tool_file_to_file():
    tf = _seed(mimetype="image/png", name="chart.png", size=99)
    file = reback_tool_file_output(tenant_id=TENANT, tool_file_id=tf)

    assert file is not None
    assert file.transfer_method == FileTransferMethod.TOOL_FILE
    assert file.related_id == tf
    assert resolve_file_record_id(file.reference) == tf
    assert file.filename == "chart.png"
    assert file.mime_type == "image/png"
    assert file.size == 99
    assert file.type == FileType.IMAGE
    assert file.extension == ".png"


def test_reback_other_tenant_returns_none():
    tf = _seed()
    assert reback_tool_file_output(tenant_id="33333333-3333-3333-3333-333333333333", tool_file_id=tf) is None


@pytest.mark.parametrize("bad", ["", "not-a-uuid", "550e8400-e29b-41d4-a716-446655440000"])
def test_reback_missing_or_malformed_returns_none(bad: str):
    # empty / non-UUID / valid-but-absent all resolve to None (never raise)
    assert reback_tool_file_output(tenant_id=TENANT, tool_file_id=bad) is None


def test_reback_empty_tenant_returns_none():
    tf = _seed()
    assert reback_tool_file_output(tenant_id="", tool_file_id=tf) is None
