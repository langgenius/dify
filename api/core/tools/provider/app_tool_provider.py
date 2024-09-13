import logging
from typing import Any

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolParameter, ToolParameterOption, ToolProviderType
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.tool.tool import Tool
from extensions.ext_database import db
from models.model import App, AppModelConfig
from models.tools import PublishedAppTool

logger = logging.getLogger(__name__)


class AppToolProviderEntity(ToolProviderController):
    @property
    def provider_type(self) -> ToolProviderType:
        return ToolProviderType.APP

    def _validate_credentials(self, tool_name: str, credentials: dict[str, Any]) -> None:
        pass

    def validate_parameters(self, tool_name: str, tool_parameters: dict[str, Any]) -> None:
        pass

    def get_tools(self, user_id: str) -> list[Tool]:
        db_tools: list[PublishedAppTool] = (
            db.session.query(PublishedAppTool)
            .filter(
                PublishedAppTool.user_id == user_id,
            )
            .all()
        )

        if not db_tools or len(db_tools) == 0:
            return []

        tools: list[Tool] = []

        for db_tool in db_tools:
            tool = {
                "identity": {
                    "author": db_tool.author,
                    "name": db_tool.tool_name,
                    "label": {"en_US": db_tool.tool_name, "zh_Hans": db_tool.tool_name},
                    "icon": "",
                },
                "description": {
                    "human": {"en_US": db_tool.description_i18n.en_US, "zh_Hans": db_tool.description_i18n.zh_Hans},
                    "llm": db_tool.llm_description,
                },
                "parameters": [],
            }
            # get app from db
            app: App = db_tool.app

            if not app:
                logger.error(f"app {db_tool.app_id} not found")
                continue

            app_model_config: AppModelConfig = app.app_model_config
            user_input_form_list = app_model_config.user_input_form_list
            for input_form in user_input_form_list:
                # get type
                form_type = input_form.keys()[0]
                default = input_form[form_type]["default"]
                required = input_form[form_type]["required"]
                label = input_form[form_type]["label"]
                variable_name = input_form[form_type]["variable_name"]
                options = input_form[form_type].get("options", [])
                if form_type in {"paragraph", "text-input"}:
                    tool["parameters"].append(
                        ToolParameter(
                            name=variable_name,
                            label=I18nObject(en_US=label, zh_Hans=label),
                            human_description=I18nObject(en_US=label, zh_Hans=label),
                            llm_description=label,
                            form=ToolParameter.ToolParameterForm.FORM,
                            type=ToolParameter.ToolParameterType.STRING,
                            required=required,
                            default=default,
                        )
                    )
                elif form_type == "select":
                    tool["parameters"].append(
                        ToolParameter(
                            name=variable_name,
                            label=I18nObject(en_US=label, zh_Hans=label),
                            human_description=I18nObject(en_US=label, zh_Hans=label),
                            llm_description=label,
                            form=ToolParameter.ToolParameterForm.FORM,
                            type=ToolParameter.ToolParameterType.SELECT,
                            required=required,
                            default=default,
                            options=[
                                ToolParameterOption(value=option, label=I18nObject(en_US=option, zh_Hans=option))
                                for option in options
                            ],
                        )
                    )

            tools.append(Tool(**tool))
        return tools
