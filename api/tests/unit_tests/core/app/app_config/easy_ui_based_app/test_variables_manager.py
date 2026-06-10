import pytest
from pytest_mock import MockerFixture

from core.app.app_config.easy_ui_based_app.variables.manager import (
    BasicVariablesConfigManager,
)
from graphon.variables.input_entities import VariableEntityType


class TestBasicVariablesConfigManagerConvert:
    def test_convert_empty_config(self):
        config = {}

        variables, external = BasicVariablesConfigManager.convert(config)

        assert variables == []
        assert external == []

    def test_convert_external_data_tools_enabled_and_disabled(self, mocker: MockerFixture):
        config = {
            "external_data_tools": [
                {"enabled": False},
                {
                    "enabled": True,
                    "variable": "ext_var",
                    "type": "tool_type",
                    "config": {"k": "v"},
                },
            ]
        }

        variables, external = BasicVariablesConfigManager.convert(config)

        assert variables == []
        assert len(external) == 1
        assert external[0].variable == "ext_var"
        assert external[0].type == "tool_type"

    def test_convert_user_input_form_variable_types(self):
        config = {
            "user_input_form": [
                {
                    VariableEntityType.TEXT_INPUT: {
                        "variable": "name",
                        "label": "Name",
                        "description": "desc",
                        "required": True,
                        "max_length": 50,
                    }
                },
                {
                    VariableEntityType.SELECT: {
                        "variable": "choice",
                        "label": "Choice",
                        "options": ["a", "b"],
                    }
                },
                {
                    VariableEntityType.EXTERNAL_DATA_TOOL: {
                        "variable": "ext",
                        "type": "tool",
                        "config": {"x": 1},
                    }
                },
            ]
        }

        variables, external = BasicVariablesConfigManager.convert(config)

        assert len(variables) == 2
        assert len(external) == 1

    def test_convert_external_data_tool_without_config_skipped(self):
        config = {
            "user_input_form": [
                {
                    VariableEntityType.EXTERNAL_DATA_TOOL: {
                        "variable": "ext",
                        "type": "tool",
                    }
                }
            ]
        }

        variables, external = BasicVariablesConfigManager.convert(config)

        assert variables == []
        assert external == []


class TestValidateVariablesAndSetDefaults:
    def test_validate_sets_empty_user_input_form_if_missing(self):
        config = {}

        updated, keys = BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

        assert updated["user_input_form"] == []
        assert "user_input_form" in keys

    def test_validate_user_input_form_not_list_raises(self):
        config = {"user_input_form": "invalid"}

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

    def test_validate_invalid_key_raises(self):
        config = {"user_input_form": [{"invalid": {}}]}

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

    def test_validate_missing_label_raises(self):
        config = {"user_input_form": [{VariableEntityType.TEXT_INPUT: {"variable": "name"}}]}

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

    def test_validate_label_not_string_raises(self):
        config = {"user_input_form": [{VariableEntityType.TEXT_INPUT: {"variable": "name", "label": 123}}]}

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

    def test_validate_missing_variable_raises(self):
        config = {"user_input_form": [{VariableEntityType.TEXT_INPUT: {"label": "Name"}}]}

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

    def test_validate_variable_not_string_raises(self):
        config = {"user_input_form": [{VariableEntityType.TEXT_INPUT: {"label": "Name", "variable": 123}}]}

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

    @pytest.mark.parametrize(
        "variable_name",
        ["1invalid", "invalid space", "", None],
    )
    def test_validate_variable_invalid_pattern_raises(self, variable_name):
        config = {
            "user_input_form": [
                {
                    VariableEntityType.TEXT_INPUT: {
                        "label": "Name",
                        "variable": variable_name,
                    }
                }
            ]
        }

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

    def test_validate_required_default_and_type(self):
        config = {
            "user_input_form": [
                {
                    VariableEntityType.TEXT_INPUT: {
                        "label": "Name",
                        "variable": "valid_name",
                    }
                }
            ]
        }

        updated, _ = BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

        assert updated["user_input_form"][0][VariableEntityType.TEXT_INPUT]["required"] is False

    def test_validate_required_not_bool_raises(self):
        config = {
            "user_input_form": [
                {
                    VariableEntityType.TEXT_INPUT: {
                        "label": "Name",
                        "variable": "valid_name",
                        "required": "yes",
                    }
                }
            ]
        }

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

    def test_validate_select_options_default_not_in_options_raises(self):
        config = {
            "user_input_form": [
                {
                    VariableEntityType.SELECT: {
                        "label": "Choice",
                        "variable": "choice",
                        "options": ["a", "b"],
                        "default": "c",
                    }
                }
            ]
        }

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)

    def test_validate_select_options_not_list_raises(self):
        config = {
            "user_input_form": [
                {
                    VariableEntityType.SELECT: {
                        "label": "Choice",
                        "variable": "choice",
                        "options": "not_list",
                    }
                }
            ]
        }

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_variables_and_set_defaults(config)


class TestValidateExternalDataToolsAndSetDefaults:
    def test_validate_sets_empty_external_data_tools_if_missing(self):
        config = {}

        updated, keys = BasicVariablesConfigManager.validate_external_data_tools_and_set_defaults("tenant", config)

        assert updated["external_data_tools"] == []
        assert "external_data_tools" in keys

    def test_validate_external_data_tools_not_list_raises(self):
        config = {"external_data_tools": "invalid"}

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_external_data_tools_and_set_defaults("tenant", config)

    def test_validate_disabled_tool_skipped(self, mocker: MockerFixture):
        config = {"external_data_tools": [{"enabled": False}]}

        spy = mocker.patch(
            "core.app.app_config.easy_ui_based_app.variables.manager.ExternalDataToolFactory.validate_config"
        )

        updated, _ = BasicVariablesConfigManager.validate_external_data_tools_and_set_defaults("tenant", config)

        spy.assert_not_called()
        assert updated["external_data_tools"][0]["enabled"] is False

    def test_validate_enabled_tool_missing_type_raises(self):
        config = {"external_data_tools": [{"enabled": True, "config": {}}]}

        with pytest.raises(ValueError):
            BasicVariablesConfigManager.validate_external_data_tools_and_set_defaults("tenant", config)

    def test_validate_enabled_tool_calls_factory(self, mocker: MockerFixture):
        config = {"external_data_tools": [{"enabled": True, "type": "tool", "config": {"a": 1}}]}

        spy = mocker.patch(
            "core.app.app_config.easy_ui_based_app.variables.manager.ExternalDataToolFactory.validate_config"
        )

        BasicVariablesConfigManager.validate_external_data_tools_and_set_defaults("tenant_id", config)

        spy.assert_called_once_with(name="tool", tenant_id="tenant_id", config={"a": 1})


class TestValidateAndSetDefaultsIntegration:
    def test_validate_and_set_defaults_calls_both(self, mocker: MockerFixture):
        config = {}

        spy_var = mocker.patch.object(
            BasicVariablesConfigManager,
            "validate_variables_and_set_defaults",
            return_value=(config, ["user_input_form"]),
        )
        spy_ext = mocker.patch.object(
            BasicVariablesConfigManager,
            "validate_external_data_tools_and_set_defaults",
            return_value=(config, ["external_data_tools"]),
        )

        updated, keys = BasicVariablesConfigManager.validate_and_set_defaults("tenant", config)

        spy_var.assert_called_once()
        spy_ext.assert_called_once()
        assert "user_input_form" in keys
        assert "external_data_tools" in keys
        assert updated == config
