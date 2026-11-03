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
    node_version,
    references_for,
)
from services.workflow.authoring.tool_reference import ToolReference, WebFormType

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")
TOOL_TYPE = ToolParameter.ToolParameterType
TOOL_FORM = ToolParameter.ToolParameterForm
TOOL = ToolReference(provider_type="builtin", provider_id="p", tool_name="t")
V2_TOOL_NODE_VERSION = "2"


def _legacy_time_tool_node(**data: object) -> dict[str, object]:
    return {
        "type": BuiltinNodeTypes.TOOL,
        "provider_type": "builtin",
        "provider_id": "time",
        "tool_name": "current_time",
        **data,
    }


def _time_tool_node(**data: object) -> dict[str, object]:
    return _legacy_time_tool_node(tool_node_version=V2_TOOL_NODE_VERSION, **data)


def _v2_node(**data: object) -> dict[str, object]:
    return {"tool_node_version": V2_TOOL_NODE_VERSION, **data}


def _configurations(raw: dict[str, object]) -> dict[str, object]:
    values = raw["tool_configurations"]
    assert isinstance(values, dict)
    return values


def _declared(name: str, *, form: str, type: str, default: object = NO_DEFAULT) -> DeclaredParameter:
    return DeclaredParameter(name=name, form=form, type=type, required=False, default=default, options=(), help=None)


def _found(*parameters: DeclaredParameter) -> PluginDeclaration:
    return PluginDeclaration(status=DeclarationStatus.FOUND, parameters=parameters)


def _stored_setting(type: str, default: object) -> object:
    raw = _v2_node()
    TOOL.apply(raw, _found(_declared("p", form=TOOL_FORM.FORM, type=type, default=default)))
    return raw.get("tool_configurations")


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
    raw = _v2_node()
    declaration = _found(
        _declared("count", form=TOOL_FORM.LLM, type=TOOL_TYPE.NUMBER, default=3),
        _declared("query", form=TOOL_FORM.LLM, type=TOOL_TYPE.STRING),
        _declared("api_key", form=TOOL_FORM.FORM, type=TOOL_TYPE.SECRET_INPUT, default="k"),
        _declared("strict", form=TOOL_FORM.FORM, type=TOOL_TYPE.BOOLEAN, default=False),
        _declared("region", form=TOOL_FORM.SCHEMA, type=TOOL_TYPE.SELECT, default="eu"),
    )

    TOOL.apply(raw, declaration)

    assert raw == _v2_node(
        tool_parameters={"count": {"type": "constant", "value": 3}},
        tool_configurations={
            "api_key": {"type": "mixed", "value": "k"},
            "strict": {"type": "constant", "value": False},
            "region": {"type": "constant", "value": "eu"},
        },
    )


def test_a_legacy_tool_node_gets_no_values() -> None:
    raw = _legacy_time_tool_node()
    before = copy.deepcopy(raw)

    fill_plugin_values(raw, CTX)

    assert raw == before


def test_an_explicit_node_version_is_honored() -> None:
    raw = _legacy_time_tool_node(version="2")

    fill_plugin_values(raw, CTX)

    assert _configurations(raw)["timezone"] == {"type": "constant", "value": "UTC"}


def test_node_version_defaults_to_the_runtime_default() -> None:
    assert node_version({}) == "1"
    assert node_version({"version": "2"}) == "2"


def test_get_configured_value_escapes_newlines_in_string_defaults() -> None:
    assert _stored_setting(TOOL_TYPE.STRING, "a\nb") == {"p": {"type": "mixed", "value": "a\\nb"}}
    assert _stored_setting(TOOL_TYPE.SELECT, "a\nb") == {"p": {"type": "constant", "value": "a\\nb"}}


def test_correct_initial_data_parses_number_input_strings_like_parse_float() -> None:
    assert _stored_setting(TOOL_TYPE.NUMBER, "2.5") == {"p": {"type": "constant", "value": 2.5}}
    assert _stored_setting(TOOL_TYPE.NUMBER, " 12abc") == {"p": {"type": "constant", "value": 12.0}}
    assert _stored_setting(TOOL_TYPE.NUMBER, 7) == {"p": {"type": "constant", "value": 7}}
    assert _stored_setting(TOOL_TYPE.NUMBER, "") == {"p": {"type": "constant", "value": ""}}


def test_a_number_default_parse_float_cannot_read_is_not_written() -> None:
    assert _stored_setting(TOOL_TYPE.NUMBER, "abc") is None
    assert _stored_setting(TOOL_TYPE.NUMBER, "1e999") is None


def test_correct_initial_data_stores_date_objects_as_json_and_strings_unescaped() -> None:
    assert _stored_setting(TOOL_TYPE.DATE_RANGE, {"start": "2026-01-01", "end": "日"}) == {
        "p": {"type": "constant", "value": '{"start":"2026-01-01","end":"日"}'}
    }
    assert _stored_setting(TOOL_TYPE.DATE, "a\nb") == {"p": {"type": "constant", "value": "a\nb"}}


def test_correct_initial_data_keeps_selector_defaults_unescaped() -> None:
    assert _stored_setting(TOOL_TYPE.MODEL_SELECTOR, "a\nb") == {"p": {"type": "constant", "value": "a\nb"}}
    assert _stored_setting(TOOL_TYPE.APP_SELECTOR, {"app_id": "x"}) == {
        "p": {"type": "constant", "value": {"app_id": "x"}}
    }


def test_apply_skips_a_default_its_input_type_cannot_hold() -> None:
    assert _stored_setting(TOOL_TYPE.STRING, 10) is None


def test_apply_keeps_a_slot_the_caller_wrote_as_something_else() -> None:
    raw = _v2_node(tool_configurations=None)

    TOOL.apply(raw, _found(_declared("timezone", form=TOOL_FORM.FORM, type=TOOL_TYPE.SELECT, default="UTC")))

    assert raw == _v2_node(tool_configurations=None)


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
    assert WebFormType.of(member).input_type in {ToolInputType.MIXED, ToolInputType.CONSTANT}


def test_a_parameter_type_without_a_rule_is_refused() -> None:
    with pytest.raises(ValueError, match="no web form type"):
        WebFormType.of("not-a-type")


def test_only_text_inputs_are_mixed() -> None:
    members = [*TOOL_TYPE, *PluginParameterType]
    mixed = {member for member in members if WebFormType.of(member).input_type == ToolInputType.MIXED}

    assert mixed == {TOOL_TYPE.STRING, TOOL_TYPE.SECRET_INPUT}


def test_form_types_follow_the_web_to_type_renames() -> None:
    assert WebFormType.of(TOOL_TYPE.STRING) == "text-input"
    assert WebFormType.of(TOOL_TYPE.NUMBER) == "number-input"
    assert WebFormType.of(TOOL_TYPE.BOOLEAN) == "checkbox"
    assert WebFormType.of(TOOL_TYPE.CHECKBOX) == "checkbox"
    assert WebFormType.of(PluginParameterType.TOOLS_SELECTOR) == "array[tools]"
