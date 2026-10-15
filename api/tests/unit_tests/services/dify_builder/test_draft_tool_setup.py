"""Draft schema binding is independent of permission to execute credentials."""

import json
from dataclasses import asdict
from types import SimpleNamespace

from sqlalchemy import text
from sqlalchemy.orm import Session

from core.app.app_config.entities import ModelConfig
from models.enums import PermissionEnum
from services.dify_builder.agent import build
from services.dify_builder.agent.llm_agent import LlmBuilderAgent
from services.workflow_generator_service import ModelManager
from tests.unit_tests.services.dify_builder.draft_tool_inventory import (
    AUTH_PROVIDER,
    DraftToolInventory,
)
from tests.unit_tests.services.dify_builder.draft_tool_inventory import (
    draft_tools as installed_draft_tools,
)
from tests.unit_tests.services.dify_builder.installed_tool_inventory import (
    ACCOUNT_A,
    ACCOUNT_B,
    SECRET_MARKER,
    TENANT_ID,
    add_credential,
)

draft_tools = installed_draft_tools


class GeneratedPlanModel:
    """Respond at the LLM boundary; retain the actual shared generator pipeline."""

    def __init__(self, *, description="User description: notify the support channel.", credential_id=None):
        self.description = description
        self.credential_id = credential_id
        self.requests = []

    def invoke_llm(self, *, prompt_messages, **kwargs):  # noqa: ARG002
        self.requests.append(prompt_messages)
        prompt = prompt_messages[1].content
        if "# Target node" in prompt:
            if "id=s, type=start," in prompt:
                payload = {"config": {"variables": []}}
            elif "id=t, type=tool," in prompt:
                config = {
                    "desc": self.description,
                    "provider_id": AUTH_PROVIDER,
                    "provider_name": AUTH_PROVIDER,
                    "provider_type": "builtin",
                    "tool_name": "post",
                    "tool_parameters": {"message": {"type": "mixed", "value": "Ticket closed"}},
                    "tool_configurations": {},
                    # Untrusted model output must be replaced by installed metadata.
                    "output_schema": {"properties": {"invented": {"type": "string"}}},
                }
                if self.credential_id is not None:
                    config["credential_id"] = self.credential_id
                payload = {"config": config}
            elif "id=e, type=end," in prompt:
                payload = {"config": {"outputs": [{"variable": "message_id", "value_selector": ["t", "message_id"]}]}}
            else:
                raise AssertionError("Unexpected node requested by the real generator")
        else:
            payload = {
                "nodes": [
                    {"id": "s", "node_type": "start", "label": "Start", "purpose": "Start"},
                    {
                        "id": "t",
                        "node_type": "tool",
                        "label": "Post to Huddle",
                        "purpose": self.description,
                        "tool": {"provider_name": AUTH_PROVIDER, "tool_name": "post"},
                    },
                    {"id": "e", "node_type": "end", "label": "End", "purpose": "Return message ID"},
                ],
                "edges": [{"source": "s", "target": "t"}, {"source": "t", "target": "e"}],
            }
        return SimpleNamespace(message=SimpleNamespace(get_text_content=lambda: json.dumps(payload)), usage=None)


def generate_draft(monkeypatch, model):
    config = ModelConfig.model_validate({"provider": "anthropic", "name": "x", "mode": "chat"})
    monkeypatch.setattr(build, "_generator_model_config", lambda *a, **k: config)  # noqa: ARG005
    monkeypatch.setattr(
        ModelManager,
        "for_tenant",
        lambda **kw: SimpleNamespace(get_model_instance=lambda **kw: model),  # noqa: ARG005
    )
    return build.build_nodes(
        TENANT_ID,
        {},
        [f"tool node uses {AUTH_PROVIDER}/post then returns message_id"],
        account_id=ACCOUNT_A,
    )


def tool_config(result):
    configs = [i.args["config"] for i in result.intents if i.op == "create_node" and i.args["node_type"] == "tool"]
    assert len(configs) == 1, f"Installed unconfigured Tool was lost: {result.error}"
    return configs[0]


def test_generated_unauthenticated_tool_has_real_schema_topology_outputs_and_visible_setup_note(
    draft_tools: DraftToolInventory,
    monkeypatch,
):
    result = generate_draft(monkeypatch, GeneratedPlanModel())
    config = tool_config(result)
    assert (config["provider_id"], config["provider_type"], config["tool_name"]) == (AUTH_PROVIDER, "builtin", "post")
    assert config["plugin_id"] == "acme/huddle"
    assert config["tool_parameters"] == {"message": {"type": "mixed", "value": "Ticket closed"}}
    assert config["output_schema"] == {"type": "object", "properties": {"message_id": {"type": "string"}}}
    assert config["paramSchemas"][0]["name"] == "message"
    assert not config.get("credential_id")
    description = config["desc"]
    assert description.startswith("User description: notify the support channel.")
    assert "Post to Huddle" in description
    assert "credential" in description.lower()
    assert "test" in description.lower()
    assert "publish" in description.lower()
    assert "Ticket closed" not in description
    assert SECRET_MARKER not in json.dumps(asdict(result))
    assert [i.args["node_type"] for i in result.intents if i.op == "create_node"] == ["start", "tool", "end"]
    assert [(i.args["from_node"], i.args["to_node"]) for i in result.intents if i.op == "connect"] == [
        ("s", "t"),
        ("t", "e"),
    ]
    end = next(i.args["config"] for i in result.intents if i.op == "create_node" and i.args["node_type"] == "end")
    assert end["outputs"] == [{"variable": "message_id", "value_selector": ["t", "message_id"]}]
    assert draft_tools.forbidden == []


def test_repeated_builder_pass_does_not_duplicate_setup_note_or_overwrite_user_edits(draft_tools, monkeypatch):
    model = GeneratedPlanModel()
    first = tool_config(generate_draft(monkeypatch, model))["desc"]
    model.description = first
    second = tool_config(generate_draft(monkeypatch, model))["desc"]
    assert second == first
    user_edit = "\nUser addition: keep channel notifications concise."
    model.description = second + user_edit
    third = tool_config(generate_draft(monkeypatch, model))["desc"]
    assert "User description: notify the support channel." in third
    assert user_edit.strip() in third
    assert third.count("Post to Huddle") == first.count("Post to Huddle")
    assert draft_tools.forbidden == []


def test_generated_private_credential_is_removed_without_discarding_the_installed_tool(
    draft_tools,
    monkeypatch,
    sqlite_session: Session,
):
    private = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_B,
        visibility=PermissionEnum.ONLY_ME,
    )
    model = GeneratedPlanModel(credential_id=private.id)
    result = generate_draft(monkeypatch, model)
    config = tool_config(result)
    assert not config.get("credential_id")
    rendered = json.dumps(asdict(result))
    assert private.id not in rendered
    assert ACCOUNT_B not in rendered
    assert private.id not in "\n".join(str(message.content) for request in model.requests for message in request)
    assert SECRET_MARKER not in rendered
    assert "credential" in config["desc"].lower()
    assert draft_tools.forbidden == []


def test_credential_query_failure_still_binds_verified_installation_with_a_verification_note(
    draft_tools,
    monkeypatch,
):
    with draft_tools.engine.begin() as connection:
        connection.execute(text("DROP TABLE tool_builtin_providers"))
    bound = build.bind_resources(
        None, TENANT_ID, ["tool node posts to Huddle"], [f"{AUTH_PROVIDER}/post"], account_id=ACCOUNT_A
    )
    assert f"[{AUTH_PROVIDER}/post]" in "\n".join(bound)
    config = tool_config(generate_draft(monkeypatch, GeneratedPlanModel()))
    assert "verif" in config["desc"].lower()
    assert draft_tools.forbidden == []


def test_planner_and_gap_provider_requests_offer_installed_setup_tools(draft_tools, monkeypatch):
    requests = []

    def model_json(_model, *, system, user, **kwargs):  # noqa: ARG001
        requests.append((system, user))
        return {"gap": "", "resource_ids": [f"{AUTH_PROVIDER}/post"]}

    def model_text(_model, *, system, user, **kwargs):  # noqa: ARG001
        requests.append((system, user))
        return json.dumps(
            {
                "title": "Post to a Huddle channel",
                "input_summary": "A message for the support channel.",
                "output_summary": "The message ID returned by Huddle.",
                "plan": [f"tool node uses {AUTH_PROVIDER}/post"],
            }
        )

    monkeypatch.setattr(build.llm, "invoke_json", model_json)
    monkeypatch.setattr(build.llm, "invoke_text", model_text)
    agent = LlmBuilderAgent(TENANT_ID, {})
    monkeypatch.setattr(agent, "_model", lambda: object())
    plan = agent.propose_plan_v1({}, goal_text="Post a message to a Huddle channel")
    assert plan is not None
    options = agent.discover_resources(plan.items, goal_text="Post a message to a Huddle channel", requirements={})
    agent.assess_capability_gap(plan.items, options, goal_text="Post a message to a Huddle channel", requirements={})
    assert f"{AUTH_PROVIDER}/post" in requests[0][0]
    assert "setup" in requests[0][0].lower()
    assert f"{AUTH_PROVIDER}/post" in requests[2][1]
    # The actual request to the gap LLM must not instruct it to invent a gap
    # merely because an installed declaration needs later credential setup.
    assert "treat a missing_config resource as unavailable" not in requests[2][0]
    assert "setup" in requests[2][0].lower()
    assert draft_tools.forbidden == []


def test_generated_configured_tool_preserves_authorized_selection_and_user_description(
    draft_tools,
    monkeypatch,
    sqlite_session,
):
    credential = add_credential(
        sqlite_session,
        tenant_id=TENANT_ID,
        provider=AUTH_PROVIDER,
        user_id=ACCOUNT_A,
    )
    config = tool_config(generate_draft(monkeypatch, GeneratedPlanModel(credential_id=credential.id)))
    assert config["credential_id"] == credential.id
    assert config["desc"] == "User description: notify the support channel."
    assert draft_tools.forbidden == []
