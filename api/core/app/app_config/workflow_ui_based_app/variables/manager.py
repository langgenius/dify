import json
import re
from typing import Any

from core.app.app_config.entities import RagPipelineVariableEntity
from graphon.variables.input_entities import VariableEntity
from models.workflow import Workflow


class WorkflowVariablesConfigManager:
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
            cls._normalize_json_schema(variable)
            variables.append(VariableEntity.model_validate(variable))

        return variables

    @staticmethod
    def _normalize_json_schema(variable: dict[str, Any]) -> None:
        """
        Normalize ``json_schema`` from a JSON string to a dict.

        The workflow graph is stored as JSON in the database.  When a JSON
        object variable carries a ``json_schema`` field, nested dicts are
        preserved correctly, but older data or certain serialization paths
        may store it as a JSON *string* instead of a native dict.

        ``VariableEntity.json_schema`` expects ``dict | None``, so we
        deserialize the string here before handing it to Pydantic.
        """
        json_schema = variable.get("json_schema")
        if isinstance(json_schema, str):
            try:
                variable["json_schema"] = json.loads(json_schema)
            except (json.JSONDecodeError, TypeError):
                # Leave as-is; Pydantic validation will surface the error.
                pass

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
