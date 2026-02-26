from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel

from core.variables.segments import StringSegment
from core.workflow.file.models import File, FileTransferMethod, FileType
from core.workflow.workflow_type_encoder import WorkflowRuntimeTypeConverter


class _DemoModel(BaseModel):
    flag: bool


def test_value_to_json_encodable_recursive_handles_supported_runtime_types() -> None:
    converter = WorkflowRuntimeTypeConverter()
    value = {
        "int": 1,
        "bool": True,
        "float": 1.2,
        "decimal": Decimal("2.5"),
        "segment": StringSegment(value="segment-value"),
        "file": File(
            tenant_id="tenant",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://example.com/report.pdf",
            filename="report.pdf",
            extension=".pdf",
            mime_type="application/pdf",
        ),
        "model": _DemoModel(flag=True),
        "dict": {"nested_segment": StringSegment(value="nested")},
        "list": [Decimal("3.5"), {"x": StringSegment(value="x")}],
    }

    encoded = converter.value_to_json_encodable_recursive(value)

    assert encoded["decimal"] == 2.5
    assert encoded["segment"] == "segment-value"
    assert encoded["file"]["url"] == "https://example.com/report.pdf"
    assert encoded["model"] == {"flag": True}
    assert encoded["dict"]["nested_segment"] == "nested"
    assert encoded["list"][0] == 3.5
    assert encoded["list"][1]["x"] == "x"


def test_to_json_encodable_returns_none_or_mapping_and_fallbacks_for_non_mapping() -> None:
    converter = WorkflowRuntimeTypeConverter()

    assert converter.to_json_encodable(None) is None
    assert converter.to_json_encodable({"x": 1}) == {"x": 1}
    assert converter.to_json_encodable([1, 2, 3]) == {}
