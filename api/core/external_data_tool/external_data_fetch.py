import logging
from collections.abc import Mapping
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from typing import Any

from flask import Flask, current_app

from core.app.app_config.entities import ExternalDataVariableEntity
from core.external_data_tool.factory import ExternalDataToolFactory

logger = logging.getLogger(__name__)


class ExternalDataFetch:
    def fetch(
        self,
        tenant_id: str,
        app_id: str,
        external_data_tools: list[ExternalDataVariableEntity],
        inputs: Mapping[str, Any],
        query: str,
    ) -> Mapping[str, Any]:
        """
        Fill in variable inputs from external data tools if exists.

        :param tenant_id: workspace id
        :param app_id: app id
        :param external_data_tools: external data tools configs
        :param inputs: the inputs
        :param query: the query
        :return: the filled inputs
        """
        results: dict[str, Any] = {}
        inputs = dict(inputs)
        with ThreadPoolExecutor() as executor:
            futures = {}
            for tool in external_data_tools:
                future: Future[tuple[str | None, str | None]] = executor.submit(
                    self._query_external_data_tool,
                    current_app._get_current_object(),  # type: ignore
                    tenant_id,
                    app_id,
                    tool,
                    inputs,
                    query,
                )

                futures[future] = tool

            for future in as_completed(futures):
                tool_variable, result = future.result()
                if tool_variable is not None:
                    results[tool_variable] = result

        inputs.update(results)
        return inputs

    def _query_external_data_tool(
        self,
        flask_app: Flask,
        tenant_id: str,
        app_id: str,
        external_data_tool: ExternalDataVariableEntity,
        inputs: Mapping[str, Any],
        query: str,
    ) -> tuple[str | None, str | None]:
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
                name=tool_type, tenant_id=tenant_id, app_id=app_id, variable=tool_variable, config=tool_config
            )

            # query external data tool
            result = external_data_tool_factory.query(inputs=inputs, query=query)

            return tool_variable, result
