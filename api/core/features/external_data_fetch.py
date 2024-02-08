import concurrent
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from flask import Flask, current_app

from core.entities.application_entities import ExternalDataVariableEntity
from core.external_data_tool.factory import ExternalDataToolFactory

logger = logging.getLogger(__name__)


class ExternalDataFetchFeature:
    def fetch(self, tenant_id: str,
              app_id: str,
              external_data_tools: list[ExternalDataVariableEntity],
              inputs: dict,
              query: str) -> dict:
        """
        Fill in variable inputs from external data tools if exists.

        :param tenant_id: workspace id
        :param app_id: app id
        :param external_data_tools: external data tools configs
        :param inputs: the inputs
        :param query: the query
        :return: the filled inputs
        """
        # Group tools by type and config
        grouped_tools = {}
        for tool in external_data_tools:
            tool_key = (tool.type, json.dumps(tool.config, sort_keys=True))
            grouped_tools.setdefault(tool_key, []).append(tool)

        results = {}
        with ThreadPoolExecutor() as executor:
            futures = {}
            for tool in external_data_tools:
                future = executor.submit(
                    self._query_external_data_tool,
                    current_app._get_current_object(),
                    tenant_id,
                    app_id,
                    tool,
                    inputs,
                    query
                )

                futures[future] = tool

            for future in concurrent.futures.as_completed(futures):
                tool_variable, result = future.result()
                results[tool_variable] = result

        inputs.update(results)
        return inputs

    def _query_external_data_tool(self, flask_app: Flask,
                                  tenant_id: str,
                                  app_id: str,
                                  external_data_tool: ExternalDataVariableEntity,
                                  inputs: dict,
                                  query: str) -> tuple[Optional[str], Optional[str]]:
        """
        Query external data tool.
        :param flask_app: flask app
        :param tenant_id: tenant id
        :param app_id: app id
        :param external_data_tool: external data tool
        :param inputs: inputs
        :param query: query
        :return:
        """
        with flask_app.app_context():
            tool_variable = external_data_tool.variable
            tool_type = external_data_tool.type
            tool_config = external_data_tool.config

            external_data_tool_factory = ExternalDataToolFactory(
                name=tool_type,
                tenant_id=tenant_id,
                app_id=app_id,
                variable=tool_variable,
                config=tool_config
            )

            # query external data tool
            result = external_data_tool_factory.query(
                inputs=inputs,
                query=query
            )

            return tool_variable, result
