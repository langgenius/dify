"""Custom API effect approval follows stored behavior through native Tool admission."""

from copy import deepcopy

import pytest

from core.dify_builder.models import Graph
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.utils.parser import ApiBasedToolSchemaParser
from services.dify_builder.code_risk_assessment import assess_code, code_facts
from services.dify_builder.effect_disclosure import disclose
from tests.unit_tests.services.dify_builder.test_confirmed_full_run import harness as _full_run_harness

harness = _full_run_harness


def api_graph() -> Graph:
    return {
        "nodes": [
            {
                "id": "api",
                "data": {
                    "type": "tool",
                    "provider_type": "api",
                    "provider_id": "owned-provider",
                    "tool_name": "get_invoice",
                    "tool_parameters": {"amount": {"type": "constant", "value": 5}},
                },
            }
        ],
        "edges": [],
    }


def bundle(description: str = "Creates an invoice.", path: str = "/invoices", method: str = "post") -> ApiToolBundle:
    return ApiBasedToolSchemaParser.parse_openapi_to_tool_bundle(
        {
            "openapi": "3.0.3",
            "info": {"title": "Synthetic", "version": "1"},
            "servers": [{"url": "https://synthetic.example.invalid"}],
            "paths": {
                path: {
                    method: {
                        "operationId": "get_invoice",
                        "description": description,
                        "requestBody": {
                            "required": True,
                            "content": {
                                "application/json": {
                                    "schema": {
                                        "type": "object",
                                        "properties": {"amount": {"type": "integer"}},
                                        "required": ["amount"],
                                    }
                                }
                            },
                        },
                        "responses": {"200": {"description": "ok"}},
                    }
                }
            },
        }
    )[0]


def test_read_shaped_api_name_without_owned_definition_never_runs() -> None:
    effects = disclose(api_graph())
    assert effects.mocked_node_ids({}) == frozenset({"api"})
    assert effects.items[0].tier == "side_effect"


@pytest.mark.parametrize(
    ("description", "classification", "tier", "mocked"),
    [
        ("Creates an invoice.", "side_effect", "side_effect", True),
        ("Searches invoices without changing stored records.", "read", "read", False),
        ("Deletes invoices permanently.", "destructive", "destructive", True),
        ("Operation behavior is undocumented.", "unknown", "side_effect", True),
    ],
)
def test_owned_api_definition_uses_semantic_assessment(
    description: str, classification: str, tier: str, mocked: bool
) -> None:
    from services.dify_builder.api_tool_effects import api_definition

    graph = api_graph()
    definitions = {"api": api_definition("owned-provider", bundle(description), "credential-version")}
    facts = code_facts(
        graph,
        inputs={},
        goal_text="Review invoices",
        model_config={"name": "selected"},
        scope_binding="",
        api_tool_definitions=definitions,
    )["api"]
    assert facts.model_facts["api_tool"]["method"] == "post"
    assert facts.model_facts["api_tool"]["openapi"]["description"] == description
    risk = assess_code(facts, reason=lambda _: {"classification": classification, "risk_notice": description})
    effects = disclose(
        graph,
        code_risk_assessments={"api": risk.model_dump()},
        code_facts_digests={"api": facts.digest},
        api_tool_definitions=definitions,
    )
    assert effects.items[0].tier == tier
    assert "amount=5" in effects.items[0].object
    assert ("api" in effects.mocked_node_ids({})) is mocked
    if classification == "side_effect":
        confirmation = effects.confirmation(["api"])
        assert effects.mocked_node_ids(confirmation) == frozenset()
        changed = {"api": api_definition("owned-provider", bundle(description, "/other"), "credential-version")}
        changed_facts = code_facts(
            graph,
            inputs={},
            goal_text="Review invoices",
            model_config={"name": "selected"},
            scope_binding="",
            api_tool_definitions=changed,
        )["api"]
        stale = disclose(
            graph,
            code_risk_assessments={"api": risk.model_dump()},
            code_facts_digests={"api": changed_facts.digest},
            api_tool_definitions=changed,
        )
        assert stale.mocked_node_ids(confirmation) == frozenset({"api"})
        changed_graph = deepcopy(graph)
        changed_graph["nodes"][0]["data"]["tool_parameters"]["amount"]["value"] = 6
        assert disclose(
            changed_graph,
            code_risk_assessments={"api": risk.model_dump()},
            code_facts_digests={"api": facts.digest},
            api_tool_definitions=definitions,
        ).mocked_node_ids(confirmation) == frozenset({"api"})


def test_api_reasoning_withholds_parameter_values_account_version_and_url_secrets() -> None:
    import json

    from services.dify_builder.api_tool_effects import api_definition

    graph = api_graph()
    graph["nodes"][0]["data"]["tool_parameters"]["amount"]["value"] = "private-parameter-body"
    operation = bundle()
    operation.server_url = "https://user:password@synthetic.example.invalid/invoices?key=private-key#private-fragment"
    definitions = {"api": api_definition("owned-provider", operation, "private-account-version")}
    facts = code_facts(
        graph,
        inputs={},
        goal_text="Review invoices",
        model_config={"name": "selected"},
        scope_binding="",
        api_tool_definitions=definitions,
    )["api"]
    encoded = json.dumps(facts.model_facts)
    for secret in (
        "private-parameter-body",
        "private-account-version",
        "user:password",
        "private-key",
        "private-fragment",
    ):
        assert secret not in encoded
    assert "synthetic.example.invalid/invoices" in encoded
    assert facts.model_facts["parameters"]["amount"]["runtime_type"] == "string"
