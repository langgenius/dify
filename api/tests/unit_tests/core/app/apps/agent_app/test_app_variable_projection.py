"""Unit tests for Agent Soul app variable projection into user_input_form."""

from __future__ import annotations

from core.app.apps.agent_app.app_variable_projection import agent_app_variables_to_user_input_form
from models.agent_config_entities import AppVariableConfig


def test_projects_hidden_select_and_json_types():
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
            AppVariableConfig(name="payload", type="json", default={"enabled": True}),
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
        {
            "json_object": {
                "label": "payload",
                "variable": "payload",
                "required": False,
                "default": {"enabled": True},
            }
        },
    ]
