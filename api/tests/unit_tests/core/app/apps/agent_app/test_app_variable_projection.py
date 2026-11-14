"""Unit tests for Agent Soul app variable projection into user_input_form."""

from __future__ import annotations

from core.app.apps.agent_app.app_variable_projection import agent_app_variables_to_user_input_form
from models.agent_config_entities import AppVariableConfig


def test_projects_hidden_and_select_types():
    user_input_form = agent_app_variables_to_user_input_form(
        [
            AppVariableConfig(
                name="expense_id",
                type="text-input",
                required=False,
                hide=True,
                default="123",
            ),
            AppVariableConfig(
                name="priority",
                type="select",
                required=True,
                options=["low", "high"],
                default="low",
            ),
        ]
    )

    assert user_input_form == [
        {
            "text-input": {
                "label": "expense_id",
                "variable": "expense_id",
                "required": False,
                "default": "123",
                "hide": True,
            }
        },
        {
            "select": {
                "label": "priority",
                "variable": "priority",
                "required": True,
                "default": "low",
                "options": ["low", "high"],
            }
        },
    ]


def test_projects_checkbox_type_written_by_the_composer():
    user_input_form = agent_app_variables_to_user_input_form(
        [AppVariableConfig(name="vip", type="checkbox", default=True)]
    )

    assert user_input_form == [
        {
            "checkbox": {
                "label": "vip",
                "variable": "vip",
                "required": False,
                "default": True,
            }
        }
    ]


def test_projects_types_the_agent_app_cannot_validate_as_text():
    user_input_form = agent_app_variables_to_user_input_form([AppVariableConfig(name="payload", type="json")])

    assert user_input_form == [{"text-input": {"label": "payload", "variable": "payload", "required": False}}]
