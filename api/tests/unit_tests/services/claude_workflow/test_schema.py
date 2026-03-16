from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest
import yaml

from services.claude_workflow.errors import ClaudeWorkflowSchemaErrorCode, ClaudeWorkflowSchemaValidationError
from services.claude_workflow.schema import ClaudeWorkflowDocument, parse_claude_workflow_document


FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures" / "claude_workflow"


def _load_fixture(name: str) -> dict:
    return yaml.safe_load((FIXTURES_DIR / name).read_text(encoding="utf-8"))


def test_parse_claude_workflow_document_accepts_supported_linear_workflow() -> None:
    document = parse_claude_workflow_document(_load_fixture("basic_llm.yml"))

    assert isinstance(document, ClaudeWorkflowDocument)
    assert document.kind == "claude-workflow"
    assert document.app.mode == "workflow"
    assert [node.id for node in document.nodes] == ["summarize", "done"]


def test_parse_claude_workflow_document_rejects_unsupported_node_types_with_stable_error_code() -> None:
    payload = deepcopy(_load_fixture("basic_llm.yml"))
    payload["nodes"][0]["type"] = "loop"

    with pytest.raises(ClaudeWorkflowSchemaValidationError) as exc_info:
        parse_claude_workflow_document(payload)

    issue = exc_info.value.errors[0]
    assert issue.code == ClaudeWorkflowSchemaErrorCode.UNSUPPORTED_NODE_TYPE
    assert issue.path == ("nodes", 0, "type")


def test_parse_claude_workflow_document_reports_missing_edge_target_path() -> None:
    with pytest.raises(ClaudeWorkflowSchemaValidationError) as exc_info:
        parse_claude_workflow_document(_load_fixture("invalid_missing_edge_target.yml"))

    issue = exc_info.value.errors[0]
    assert issue.code == ClaudeWorkflowSchemaErrorCode.UNKNOWN_EDGE_TARGET
    assert issue.path == ("edges", 1, "target")


def test_parse_claude_workflow_document_reports_bad_variable_selector_path() -> None:
    payload = deepcopy(_load_fixture("basic_llm.yml"))
    payload["nodes"][1]["outputs"][0]["selector"] = ["missing-node", "text"]

    with pytest.raises(ClaudeWorkflowSchemaValidationError) as exc_info:
        parse_claude_workflow_document(payload)

    issue = exc_info.value.errors[0]
    assert issue.code == ClaudeWorkflowSchemaErrorCode.UNKNOWN_VARIABLE_SELECTOR_SOURCE
    assert issue.path == ("nodes", 1, "outputs", 0, "selector")
