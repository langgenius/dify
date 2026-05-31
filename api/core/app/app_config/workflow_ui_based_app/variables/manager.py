import json
import re
from typing import Any

from core.app.app_config.entities import RagPipelineVariableEntity
from graphon.variables.input_entities import VariableEntity
from models.workflow import Workflow


class WorkflowVariablesConfigManager:
    @staticmethod
    def _normalize_variable(variable: Any) -> Any:
        if not isinstance(variable, dict):
            return variable

        json_schema = variable.get("json_schema")
        if not isinstance(json_schema, str):
            return variable

        stripped = json_schema.strip()
        normalized = dict(variable)
        if not stripped:
            normalized["json_schema"] = None
            return normalized

        normalized["json_schema"] = json.loads(stripped)
        return normalized

    @classmethod
    def convert(cls, workflow: Workflow) -> list[VariableEntity]:
        """
        Convert workflow start variables to variables

        :param workflow: workflow instance
        """
        variables = []

        # find start node
        user_input_form = workflow.user_input_form()

        # variables
        for variable in user_input_form:
            variables.append(VariableEntity.model_validate(cls._normalize_variable(variable)))

        return variables

    @classmethod
    def convert_rag_pipeline_variable(cls, workflow: Workflow, start_node_id: str) -> list[RagPipelineVariableEntity]:
        """
        Convert workflow start variables to variables

        :param workflow: workflow instance
        """
        variables = []

        # get second step node
        rag_pipeline_variables = workflow.rag_pipeline_variables
        if not rag_pipeline_variables:
            return []
        variables_map = {item["variable"]: item for item in rag_pipeline_variables}

        # get datasource node data
        datasource_node_data = None
        datasource_nodes = workflow.graph_dict.get("nodes", [])
        for datasource_node in datasource_nodes:
            if datasource_node.get("id") == start_node_id:
                datasource_node_data = datasource_node.get("data", {})
                break
        if datasource_node_data:
            datasource_parameters = datasource_node_data.get("datasource_parameters", {})

            for _, value in datasource_parameters.items():
                if value.get("value") and isinstance(value.get("value"), str):
                    pattern = r"\{\{#([a-zA-Z0-9_]{1,50}(?:\.[a-zA-Z0-9_][a-zA-Z0-9_]{0,29}){1,10})#\}\}"
                    match = re.match(pattern, value["value"])
                    if match:
                        full_path = match.group(1)
                        last_part = full_path.split(".")[-1]
                        variables_map.pop(last_part, None)
                if value.get("value") and isinstance(value.get("value"), list):
                    last_part = value.get("value")[-1]
                    variables_map.pop(last_part, None)

        all_second_step_variables = list(variables_map.values())

        for item in all_second_step_variables:
            if item.get("belong_to_node_id") == start_node_id or item.get("belong_to_node_id") == "shared":
                variables.append(RagPipelineVariableEntity.model_validate(item))

        return variables
