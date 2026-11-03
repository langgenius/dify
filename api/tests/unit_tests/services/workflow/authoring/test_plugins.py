import copy

import pytest

from core.plugin.entities.parameters import PluginParameterType
from core.plugin.impl.tool import PluginToolManager
from core.tools.entities.tool_entities import ToolParameter
from core.trigger.constants import TRIGGER_PLUGIN_NODE_TYPE
from core.workflow.node_factory import node_data_model, resolve_workflow_node_class
from core.workflow.nodes.trigger_plugin.entities import TriggerEventNodeData
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.llm.entities import LLMNodeData
from graphon.nodes.tool.entities import ToolInputType, ToolNodeData
from services.workflow.authoring import FillContext, tool_reference
from services.workflow.authoring.plugins import (
    NO_DEFAULT,
    DatasourceReference,
    DeclarationStatus,
    DeclaredParameter,
    PluginDeclaration,
    TriggerEventReference,
    fill_plugin_values,
    node_references,
    references_for,
)
from services.workflow.authoring.tool_reference import ToolReference, tool_input_type

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")
TOOL_TYPE = ToolParameter.ToolParameterType
TOOL_FORM = ToolParameter.ToolParameterForm


def _time_tool_node(**data: object) -> dict[str, object]:
    return {
        "type": BuiltinNodeTypes.TOOL,
        "provider_type": "builtin",
        "provider_id": "time",
        "tool_name": "current_time",
        **data,
    }


def _configurations(raw: dict[str, object]) -> dict[str, object]:
    values = raw["tool_configurations"]
    assert isinstance(values, dict)
    return values


def _declared(name: str, *, form: str, type: str, default: object = NO_DEFAULT) -> DeclaredParameter:
    return DeclaredParameter(name=name, form=form, type=type, required=False, default=default, options=(), help=None)


def test_tool_node_gets_declared_defaults_in_the_web_shape() -> None:
    raw = _time_tool_node()

    fill_plugin_values(raw, CTX)

    assert raw["tool_configurations"] == {
        "format": {"type": "mixed", "value": "%Y-%m-%d %H:%M:%S"},
        "timezone": {"type": "constant", "value": "UTC"},
    }
    assert "tool_parameters" not in raw


def test_filled_tool_values_validate_as_tool_inputs() -> None:
    raw = _time_tool_node()

    fill_plugin_values(raw, CTX)

    for value in _configurations(raw).values():
        ToolNodeData.ToolInput.model_validate(value)


def test_values_the_caller_wrote_are_kept() -> None:
    written = {"type": "constant", "value": "%H:%M"}
    raw = _time_tool_node(tool_configurations={"format": written})

    fill_plugin_values(raw, CTX)

    assert _configurations(raw)["format"] == written
    assert _configurations(raw)["timezone"] == {"type": "constant", "value": "UTC"}


def test_fill_is_idempotent() -> None:
    raw = _time_tool_node()
    fill_plugin_values(raw, CTX)
    once = copy.deepcopy(raw)

    fill_plugin_values(raw, CTX)

    assert raw == once


def test_uninstalled_tool_leaves_the_node_as_written(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PluginToolManager, "fetch_tool_provider", lambda _self, _tenant_id, _provider: None)
    raw = _time_tool_node(provider_id="missing")
    before = copy.deepcopy(raw)

    fill_plugin_values(raw, CTX)

    assert raw == before
    [reference] = node_references(raw)
    assert reference.resolve(CTX).status == DeclarationStatus.NOT_INSTALLED


def test_a_lookup_error_is_not_found_not_a_crash(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(**_kwargs: object) -> None:
        raise RuntimeError("plugin daemon down")

    monkeypatch.setattr(tool_reference, "resolve_tool", broken)
    raw = _time_tool_node()
    before = copy.deepcopy(raw)

    fill_plugin_values(raw, CTX)

    assert raw == before
    [reference] = node_references(raw)
    assert reference.resolve(CTX) == PluginDeclaration(status=DeclarationStatus.NOT_FOUND)


def test_a_found_tool_declares_its_parameters() -> None:
    [reference] = node_references(_time_tool_node())

    declaration = reference.resolve(CTX)

    assert declaration.status == DeclarationStatus.FOUND
    format_parameter, timezone_parameter = declaration.parameters
    assert format_parameter == DeclaredParameter(
        name="format",
        form="form",
        type="string",
        required=False,
        default="%Y-%m-%d %H:%M:%S",
        options=(),
        help="Time format in strftime standard.",
    )
    assert timezone_parameter.type == "select"
    assert "Asia/Shanghai" in timezone_parameter.options


def test_tool_reference_key_names_the_tool() -> None:
    [reference] = node_references(_time_tool_node())

    assert reference.key == "builtin/time/current_time"


def test_apply_puts_llm_inputs_in_tool_parameters_and_settings_in_tool_configurations() -> None:
    raw: dict[str, object] = {}
    declaration = PluginDeclaration(
        status=DeclarationStatus.FOUND,
        parameters=(
            _declared("count", form=TOOL_FORM.LLM, type=TOOL_TYPE.NUMBER, default=3),
            _declared("query", form=TOOL_FORM.LLM, type=TOOL_TYPE.STRING),
            _declared("api_key", form=TOOL_FORM.FORM, type=TOOL_TYPE.SECRET_INPUT, default="k"),
            _declared("strict", form=TOOL_FORM.FORM, type=TOOL_TYPE.BOOLEAN, default=False),
        ),
    )

    ToolReference(provider_type="builtin", provider_id="p", tool_name="t").apply(raw, declaration)

    assert raw == {
        "tool_parameters": {"count": {"type": "constant", "value": 3}},
        "tool_configurations": {
            "api_key": {"type": "mixed", "value": "k"},
            "strict": {"type": "constant", "value": False},
        },
    }


def test_apply_skips_a_default_its_input_type_cannot_hold() -> None:
    raw: dict[str, object] = {}
    declaration = PluginDeclaration(
        status=DeclarationStatus.FOUND,
        parameters=(_declared("name", form=TOOL_FORM.FORM, type=TOOL_TYPE.STRING, default=10),),
    )

    ToolReference(provider_type="builtin", provider_id="p", tool_name="t").apply(raw, declaration)

    assert raw == {}


def test_apply_keeps_a_slot_the_caller_wrote_as_something_else() -> None:
    raw: dict[str, object] = {"tool_configurations": None}
    declaration = PluginDeclaration(
        status=DeclarationStatus.FOUND,
        parameters=(_declared("timezone", form=TOOL_FORM.FORM, type=TOOL_TYPE.SELECT, default="UTC"),),
    )

    ToolReference(provider_type="builtin", provider_id="p", tool_name="t").apply(raw, declaration)

    assert raw == {"tool_configurations": None}


def test_non_plugin_node_has_no_references() -> None:
    assert node_references({"type": BuiltinNodeTypes.LLM}) == []


def test_unknown_node_type_has_no_references() -> None:
    assert node_references({"type": "not-a-node"}) == []
    assert node_references({}) == []


def test_a_tool_node_without_its_identity_has_no_references() -> None:
    assert node_references({"type": BuiltinNodeTypes.TOOL, "provider_type": "builtin", "tool_name": "x"}) == []


def test_references_follow_the_node_data_model() -> None:
    def model_of(node_type: str) -> type:
        return node_data_model(resolve_workflow_node_class(node_type=node_type, node_version="1"))

    assert references_for(ToolNodeData) is ToolReference
    assert references_for(LLMNodeData) is None
    assert references_for(TriggerEventNodeData) is TriggerEventReference
    assert references_for(model_of(BuiltinNodeTypes.DATASOURCE)) is DatasourceReference


def test_deferred_plugin_kinds_give_no_references() -> None:
    raw = {"type": TRIGGER_PLUGIN_NODE_TYPE, "plugin_id": "p", "provider_id": "p/x", "event_name": "e"}

    assert node_references(raw) == []
    assert node_references({"type": BuiltinNodeTypes.DATASOURCE, "plugin_id": "p", "provider_type": "x"}) == []


@pytest.mark.parametrize("member", [*TOOL_TYPE, *PluginParameterType])
def test_apply_has_a_rule_for_every_declared_parameter_type(member: str) -> None:
    assert tool_input_type(member) in {ToolInputType.MIXED, ToolInputType.CONSTANT}


def test_only_text_inputs_are_mixed() -> None:
    mixed = {member for member in [*TOOL_TYPE, *PluginParameterType] if tool_input_type(member) == ToolInputType.MIXED}

    assert mixed == {TOOL_TYPE.STRING, TOOL_TYPE.SECRET_INPUT}
