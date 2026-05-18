import binascii
import datetime
from enum import StrEnum

import pytest
from flask import Response
from pydantic import ValidationError
from pytest_mock import MockerFixture

from core.plugin.entities.endpoint import EndpointEntityWithInstance
from core.plugin.entities.marketplace import MarketplacePluginDeclaration, MarketplacePluginSnapshot
from core.plugin.entities.parameters import (
    PluginParameter,
    PluginParameterOption,
    PluginParameterType,
    as_normal_type,
    cast_parameter_value,
    init_frontend_parameter,
)
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.entities.request import (
    RequestInvokeLLM,
    RequestInvokeSpeech2Text,
    TriggerDispatchResponse,
    TriggerInvokeEventResponse,
)
from core.plugin.utils.http_parser import serialize_response
from core.tools.entities.common_entities import I18nObject
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    SystemPromptMessage,
    ToolPromptMessage,
    UserPromptMessage,
)


class TestEndpointEntity:
    def test_endpoint_entity_with_instance_renders_url(self, mocker: MockerFixture):
        mocker.patch("core.plugin.entities.endpoint.dify_config.ENDPOINT_URL_TEMPLATE", "https://dify.test/{hook_id}")
        now = datetime.datetime.now(datetime.UTC)

        entity = EndpointEntityWithInstance.model_validate(
            {
                "id": "ep-1",
                "created_at": now,
                "updated_at": now,
                "settings": {},
                "tenant_id": "tenant",
                "plugin_id": "org/plugin",
                "expired_at": now,
                "name": "my-endpoint",
                "enabled": True,
                "hook_id": "hook-123",
            }
        )

        assert entity.url == "https://dify.test/hook-123"

    def test_endpoint_entity_with_instance_keeps_existing_url(self):
        now = datetime.datetime.now(datetime.UTC)
        entity = EndpointEntityWithInstance.model_validate(
            {
                "id": "ep-1",
                "created_at": now,
                "updated_at": now,
                "settings": {},
                "tenant_id": "tenant",
                "plugin_id": "org/plugin",
                "expired_at": now,
                "name": "my-endpoint",
                "enabled": True,
                "hook_id": "hook-123",
                "url": "https://preset.test/hook-123",
            }
        )
        assert entity.url == "https://preset.test/hook-123"


class TestMarketplaceEntities:
    def test_marketplace_declaration_strips_empty_optional_fields(self):
        declaration = MarketplacePluginDeclaration.model_validate(
            {
                "name": "plugin",
                "org": "org",
                "plugin_id": "org/plugin",
                "icon": "icon.png",
                "label": {"en_US": "Plugin"},
                "brief": {"en_US": "Brief"},
                "resource": {"memory": 256},
                "endpoint": {},
                "model": {},
                "tool": {},
                "latest_version": "1.0.0",
                "latest_package_identifier": "org/plugin@1.0.0",
                "status": "active",
                "deprecated_reason": "",
                "alternative_plugin_id": "",
            }
        )

        assert declaration.endpoint is None
        assert declaration.model is None
        assert declaration.tool is None

    def test_marketplace_snapshot_computed_plugin_id(self):
        snapshot = MarketplacePluginSnapshot(
            org="langgenius",
            name="search",
            latest_version="1.0.0",
            latest_package_identifier="langgenius/search@1.0.0",
            latest_package_url="https://example.com/pkg",
        )
        assert snapshot.plugin_id == "langgenius/search"


class TestPluginParameterEntities:
    def _label(self) -> I18nObject:
        return I18nObject(en_US="label")

    def test_parameter_option_value_casts_to_string(self):
        option = PluginParameterOption(value=123, label=self._label())
        assert option.value == "123"

    def test_plugin_parameter_options_non_list_defaults_to_empty(self):
        parameter = PluginParameter(name="p", label=self._label(), options="invalid")  # type: ignore[arg-type]
        assert parameter.options == []

    @pytest.mark.parametrize(
        ("parameter_type", "expected"),
        [
            (PluginParameterType.SECRET_INPUT, "string"),
            (PluginParameterType.SELECT, "string"),
            (PluginParameterType.CHECKBOX, "string"),
            (PluginParameterType.NUMBER, PluginParameterType.NUMBER.value),
        ],
    )
    def test_as_normal_type(self, parameter_type, expected):
        assert as_normal_type(parameter_type) == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [(None, ""), (1, "1"), ("abc", "abc")],
    )
    def test_cast_parameter_value_string_like(self, value, expected):
        assert cast_parameter_value(PluginParameterType.STRING, value) == expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (None, False),
            ("true", True),
            ("yes", True),
            ("1", True),
            ("false", False),
            ("0", False),
            ("random", True),
            (1, True),
            (0, False),
        ],
    )
    def test_cast_parameter_value_boolean(self, value, expected):
        assert cast_parameter_value(PluginParameterType.BOOLEAN, value) is expected

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (1, 1),
            (1.5, 1.5),
            ("2", 2),
            ("2.5", 2.5),
        ],
    )
    def test_cast_parameter_value_number(self, value, expected):
        assert cast_parameter_value(PluginParameterType.NUMBER, value) == expected

    def test_cast_parameter_value_file_and_files(self):
        assert cast_parameter_value(PluginParameterType.FILES, "f1") == ["f1"]
        assert cast_parameter_value(PluginParameterType.SYSTEM_FILES, ["f1", "f2"]) == ["f1", "f2"]
        assert cast_parameter_value(PluginParameterType.FILE, ["one"]) == "one"
        assert cast_parameter_value(PluginParameterType.FILE, "one") == "one"
        with pytest.raises(ValueError, match="only accepts one file"):
            cast_parameter_value(PluginParameterType.FILE, ["a", "b"])

    @pytest.mark.parametrize(
        ("parameter_type", "value", "expected"),
        [
            (PluginParameterType.MODEL_SELECTOR, {"m": "gpt"}, {"m": "gpt"}),
            (PluginParameterType.APP_SELECTOR, {"app": "a"}, {"app": "a"}),
            (PluginParameterType.TOOLS_SELECTOR, [], []),
            (PluginParameterType.ANY, {"k": "v"}, {"k": "v"}),
        ],
    )
    def test_cast_parameter_value_selectors_valid(self, parameter_type, value, expected):
        assert cast_parameter_value(parameter_type, value) == expected

    @pytest.mark.parametrize(
        ("parameter_type", "value", "message"),
        [
            (PluginParameterType.MODEL_SELECTOR, "bad", "selector must be a dictionary"),
            (PluginParameterType.APP_SELECTOR, "bad", "selector must be a dictionary"),
            (PluginParameterType.TOOLS_SELECTOR, "bad", "tools selector must be a list"),
            (PluginParameterType.ANY, object(), "var selector must be"),
        ],
    )
    def test_cast_parameter_value_selectors_invalid(self, parameter_type, value, message):
        with pytest.raises(ValueError, match=message):
            cast_parameter_value(parameter_type, value)

    @pytest.mark.parametrize(
        ("parameter_type", "value", "expected"),
        [
            (PluginParameterType.ARRAY, [1, 2], [1, 2]),
            (PluginParameterType.ARRAY, "[1, 2]", [1, 2]),
            (PluginParameterType.OBJECT, {"k": "v"}, {"k": "v"}),
            (PluginParameterType.OBJECT, '{"a":1}', {"a": 1}),
        ],
    )
    def test_cast_parameter_value_array_and_object_valid(self, parameter_type, value, expected):
        assert cast_parameter_value(parameter_type, value) == expected

    @pytest.mark.parametrize(
        ("parameter_type", "value", "expected"),
        [
            (PluginParameterType.ARRAY, "bad-json", ["bad-json"]),
            (PluginParameterType.OBJECT, "bad-json", {}),
        ],
    )
    def test_cast_parameter_value_array_and_object_invalid_json_fallback(self, parameter_type, value, expected):
        assert cast_parameter_value(parameter_type, value) == expected

    def test_cast_parameter_value_default_branch_and_wrapped_exception(self):
        class _Unknown(StrEnum):
            CUSTOM = "custom"

        assert cast_parameter_value(_Unknown.CUSTOM, 12) == "12"

        class _BadString:
            def __str__(self):
                raise RuntimeError("boom")

        with pytest.raises(
            ValueError,
            match=r"The tool parameter value <.*_BadString object at .* is not in correct type of string\.",
        ):
            cast_parameter_value(PluginParameterType.STRING, _BadString())

    def test_init_frontend_parameter(self):
        rule = PluginParameter(
            name="choice",
            label=self._label(),
            required=True,
            default="a",
            options=[PluginParameterOption(value="a", label=self._label())],
        )

        assert init_frontend_parameter(rule, PluginParameterType.SELECT, None) == "a"
        assert init_frontend_parameter(rule, PluginParameterType.NUMBER, 0) == 0
        with pytest.raises(ValueError, match="not in options"):
            init_frontend_parameter(rule, PluginParameterType.SELECT, "b")

        required_rule = PluginParameter(name="required", label=self._label(), required=True, default=None)
        with pytest.raises(ValueError, match="not found in tool config"):
            init_frontend_parameter(required_rule, PluginParameterType.STRING, None)


class TestPluginDaemonEntities:
    def test_credential_type_helpers(self):
        assert CredentialType.API_KEY.get_name() == "API KEY"
        assert CredentialType.OAUTH2.get_name() == "AUTH"
        assert CredentialType.UNAUTHORIZED.get_name() == "UNAUTHORIZED"

        class _FakeCredential:
            value = "custom-type"

        assert CredentialType.get_name(_FakeCredential()) == "CUSTOM TYPE"
        assert CredentialType.API_KEY.is_editable() is True
        assert CredentialType.OAUTH2.is_editable() is False
        assert CredentialType.API_KEY.is_validate_allowed() is True
        assert CredentialType.UNAUTHORIZED.is_validate_allowed() is False
        assert set(CredentialType.values()) == {"api-key", "oauth2", "unauthorized"}

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("api-key", CredentialType.API_KEY),
            ("api_key", CredentialType.API_KEY),
            ("oauth2", CredentialType.OAUTH2),
            ("oauth", CredentialType.OAUTH2),
            ("unauthorized", CredentialType.UNAUTHORIZED),
        ],
    )
    def test_credential_type_of(self, raw, expected):
        assert CredentialType.of(raw) == expected

    def test_credential_type_of_invalid(self):
        with pytest.raises(ValueError, match="Invalid credential type"):
            CredentialType.of("invalid")


class TestPluginRequestEntities:
    def test_request_invoke_llm_converts_prompt_messages(self):
        payload = RequestInvokeLLM(
            provider="openai",
            model="gpt-4",
            mode="chat",
            prompt_messages=[
                {"role": "user", "content": "u"},
                {"role": "assistant", "content": "a"},
                {"role": "system", "content": "s"},
                {"role": "tool", "content": "t", "tool_call_id": "call-1"},
            ],
        )

        assert isinstance(payload.prompt_messages[0], UserPromptMessage)
        assert isinstance(payload.prompt_messages[1], AssistantPromptMessage)
        assert isinstance(payload.prompt_messages[2], SystemPromptMessage)
        assert isinstance(payload.prompt_messages[3], ToolPromptMessage)

    def test_request_invoke_llm_prompt_messages_must_be_list(self):
        with pytest.raises(ValidationError):
            RequestInvokeLLM(provider="openai", model="gpt-4", mode="chat", prompt_messages="invalid")  # type: ignore[arg-type]

    def test_request_invoke_speech2text_hex_conversion_and_error(self):
        payload = RequestInvokeSpeech2Text(provider="openai", model="m", file=binascii.hexlify(b"abc").decode())
        assert payload.file == b"abc"
        with pytest.raises(ValidationError):
            RequestInvokeSpeech2Text(provider="openai", model="m", file=b"abc")  # type: ignore[arg-type]

    def test_trigger_invoke_event_response_variables_conversion(self):
        converted = TriggerInvokeEventResponse(variables='{"a": 1}', cancelled=False)
        assert converted.variables == {"a": 1}
        passthrough = TriggerInvokeEventResponse(variables={"b": 2}, cancelled=True)
        assert passthrough.variables == {"b": 2}

    def test_trigger_dispatch_response_convert_response(self):
        response = Response("ok", status=202, headers={"X-Req": "1"})
        encoded = binascii.hexlify(serialize_response(response)).decode()
        parsed = TriggerDispatchResponse(user_id="u", events=["e"], response=encoded)
        assert parsed.response.status_code == 202
        assert parsed.response.get_data() == b"ok"
        with pytest.raises(ValidationError):
            TriggerDispatchResponse(user_id="u", events=["e"], response="not-hex")

    def test_trigger_dispatch_response_payload_default(self):
        response = Response("ok", status=200)
        encoded = binascii.hexlify(serialize_response(response)).decode()
        parsed = TriggerDispatchResponse(user_id="u", events=["e"], response=encoded)
        assert parsed.payload == {}
