from __future__ import annotations

from types import SimpleNamespace

import pytest

from services.agent_safety_review_service import AgentSafetyReviewBlockedError, AgentSafetyReviewService


def _workflow(graph, **overrides):
    workflow = SimpleNamespace(
        id="workflow-1",
        app_id="app-1",
        version="draft",
        graph_dict=graph,
        environment_variables=[],
        conversation_variables=[],
    )
    for key, value in overrides.items():
        setattr(workflow, key, value)
    return workflow


def test_review_approves_basic_workflow() -> None:
    workflow = _workflow({"nodes": [{"id": "start", "data": {"type": "start"}}], "edges": []})

    report = AgentSafetyReviewService.review_workflow(workflow=workflow, app_id="app-1")

    assert report["decision"] == "approved"
    assert report["summary"]["blocking_findings"] == 0


def test_review_blocks_dynamic_http_target() -> None:
    workflow = _workflow(
        {
            "nodes": [
                {
                    "id": "http-1",
                    "data": {
                        "type": "http-request",
                        "url": {"value": "https://{{#conversation.target_host#}}/callback"},
                    },
                }
            ],
            "edges": [],
        }
    )

    report = AgentSafetyReviewService.review_workflow(workflow=workflow, app_id="app-1")

    assert report["decision"] == "blocked"
    assert any(finding["rule_id"] == "http.dynamic_url" for finding in report["findings"])


def test_review_blocks_internal_metadata_target() -> None:
    workflow = _workflow(
        {
            "nodes": [
                {
                    "id": "http-1",
                    "data": {"type": "http-request", "url": "http://169.254.169.254/latest/meta-data"},
                }
            ],
            "edges": [],
        }
    )

    with pytest.raises(AgentSafetyReviewBlockedError) as exc:
        AgentSafetyReviewService.assert_workflow_safe_for_publish(workflow=workflow, app_id="app-1")

    assert exc.value.report["summary"]["critical"] == 1


def test_agent_tool_without_human_review_is_blocked() -> None:
    workflow = _workflow(
        {
            "nodes": [
                {
                    "id": "agent-1",
                    "data": {
                        "type": "agent",
                        "agent_strategy": "react",
                        "tools": [{"provider_id": "slack", "tool_name": "send_message"}],
                    },
                }
            ],
            "edges": [],
        }
    )

    report = AgentSafetyReviewService.review_workflow(workflow=workflow, app_id="app-1")

    assert report["decision"] == "blocked"
    assert any(finding["rule_id"] == "agent.tools.require_review" for finding in report["findings"])


def test_agent_tool_with_human_review_downgrades_to_warning() -> None:
    workflow = _workflow(
        {
            "nodes": [
                {
                    "id": "agent-1",
                    "data": {
                        "type": "agent",
                        "tools": [{"provider_id": "slack", "tool_name": "send_message"}],
                    },
                },
                {"id": "review-1", "data": {"type": "human-input", "title": "Release approval"}},
            ],
            "edges": [],
        }
    )

    report = AgentSafetyReviewService.review_workflow(workflow=workflow, app_id="app-1")

    assert report["decision"] == "approved"
    assert report["summary"]["medium"] >= 1
