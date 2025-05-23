from collections.abc import Generator, Mapping, Sequence
from typing import Any, cast

from core.datasource.entities.datasource_entities import (
    DatasourceParameter,
    DatasourceProviderType,
    GetOnlineDocumentPageContentRequest,
    GetOnlineDocumentPageContentResponse,
    GetWebsiteCrawlRequest,
    GetWebsiteCrawlResponse,
)
from core.datasource.online_document.online_document_plugin import OnlineDocumentDatasourcePlugin
from core.datasource.website_crawl.website_crawl_plugin import WebsiteCrawlDatasourcePlugin
from core.file import File
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.variables.segments import ArrayAnySegment
from core.variables.variables import ArrayAnyVariable
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.event import RunCompletedEvent
from core.workflow.utils.variable_template_parser import VariableTemplateParser
from models.workflow import WorkflowNodeExecutionStatus

from .entities import DatasourceNodeData
from .exc import DatasourceNodeError, DatasourceParameterError


class DatasourceNode(BaseNode[DatasourceNodeData]):
    """
    Datasource Node
    """

    _node_data_cls = DatasourceNodeData
    _node_type = NodeType.DATASOURCE

    def _run(self) -> Generator:
        """
        Run the datasource node
        """

        node_data = cast(DatasourceNodeData, self.node_data)

        # fetch datasource icon
        datasource_info = {
            "provider_id": node_data.provider_id,
            "plugin_unique_identifier": node_data.plugin_unique_identifier,
        }

        # get datasource runtime
        try:
            from core.datasource.datasource_manager import DatasourceManager

            datasource_runtime = DatasourceManager.get_datasource_runtime(
                provider_id=node_data.provider_id,
                datasource_name=node_data.datasource_name,
                tenant_id=self.tenant_id,
                datasource_type=DatasourceProviderType(node_data.provider_type),
            )
        except DatasourceNodeError as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs={},
                    metadata={NodeRunMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to get datasource runtime: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
            return

        # get parameters
        datasource_parameters = datasource_runtime.entity.parameters
        parameters = self._generate_parameters(
            datasource_parameters=datasource_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
        )
        parameters_for_log = self._generate_parameters(
            datasource_parameters=datasource_parameters,
            variable_pool=self.graph_runtime_state.variable_pool,
            node_data=self.node_data,
            for_log=True,
        )

        try:
            if datasource_runtime.datasource_provider_type() == DatasourceProviderType.ONLINE_DOCUMENT:
                datasource_runtime = cast(OnlineDocumentDatasourcePlugin, datasource_runtime)
                online_document_result: GetOnlineDocumentPageContentResponse = (
                    datasource_runtime._get_online_document_page_content(
                        user_id=self.user_id,
                        datasource_parameters=GetOnlineDocumentPageContentRequest(**parameters),
                        provider_type=datasource_runtime.datasource_provider_type(),
                    )
                )
                yield RunCompletedEvent(
                    run_result=NodeRunResult(
                        status=WorkflowNodeExecutionStatus.SUCCEEDED,
                        inputs=parameters_for_log,
                        metadata={NodeRunMetadataKey.DATASOURCE_INFO: datasource_info},
                        outputs={
                            "online_document": online_document_result.result.model_dump(),
                            "datasource_type": datasource_runtime.datasource_provider_type,
                        },
                    )
                )
            elif datasource_runtime.datasource_provider_type == DatasourceProviderType.WEBSITE_CRAWL:
                datasource_runtime = cast(WebsiteCrawlDatasourcePlugin, datasource_runtime)
                website_crawl_result: GetWebsiteCrawlResponse = datasource_runtime._get_website_crawl(
                    user_id=self.user_id,
                    datasource_parameters=GetWebsiteCrawlRequest(**parameters),
                    provider_type=datasource_runtime.datasource_provider_type(),
                )
                yield RunCompletedEvent(
                    run_result=NodeRunResult(
                        status=WorkflowNodeExecutionStatus.SUCCEEDED,
                        inputs=parameters_for_log,
                        metadata={NodeRunMetadataKey.DATASOURCE_INFO: datasource_info},
                        outputs={
                            "website": website_crawl_result.result.model_dump(),
                            "datasource_type": datasource_runtime.datasource_provider_type,
                        },
                    )
                )
            else:
                raise DatasourceNodeError(
                    f"Unsupported datasource provider: {datasource_runtime.datasource_provider_type}"
                )
        except PluginDaemonClientSideError as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={NodeRunMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to transform datasource message: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
        except DatasourceNodeError as e:
            yield RunCompletedEvent(
                run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={NodeRunMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to invoke datasource: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
            return

    def _generate_parameters(
        self,
        *,
        datasource_parameters: Sequence[DatasourceParameter],
        variable_pool: VariablePool,
        node_data: DatasourceNodeData,
        for_log: bool = False,
    ) -> dict[str, Any]:
        """
        Generate parameters based on the given tool parameters, variable pool, and node data.

        Args:
            tool_parameters (Sequence[ToolParameter]): The list of tool parameters.
            variable_pool (VariablePool): The variable pool containing the variables.
            node_data (ToolNodeData): The data associated with the tool node.

        Returns:
            Mapping[str, Any]: A dictionary containing the generated parameters.

        """
        datasource_parameters_dictionary = {parameter.name: parameter for parameter in datasource_parameters}

        result: dict[str, Any] = {}
        for parameter_name in node_data.datasource_parameters:
            parameter = datasource_parameters_dictionary.get(parameter_name)
            if not parameter:
                result[parameter_name] = None
                continue
            datasource_input = node_data.datasource_parameters[parameter_name]
            if datasource_input.type == "variable":
                variable = variable_pool.get(datasource_input.value)
                if variable is None:
                    raise DatasourceParameterError(f"Variable {datasource_input.value} does not exist")
                parameter_value = variable.value
            elif datasource_input.type in {"mixed", "constant"}:
                segment_group = variable_pool.convert_template(str(datasource_input.value))
                parameter_value = segment_group.log if for_log else segment_group.text
            else:
                raise DatasourceParameterError(f"Unknown datasource input type '{datasource_input.type}'")
            result[parameter_name] = parameter_value

        return result

    def _fetch_files(self, variable_pool: VariablePool) -> list[File]:
        variable = variable_pool.get(["sys", SystemVariableKey.FILES.value])
        assert isinstance(variable, ArrayAnyVariable | ArrayAnySegment)
        return list(variable.value) if variable else []

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: DatasourceNodeData,
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        result = {}
        for parameter_name in node_data.datasource_parameters:
            input = node_data.datasource_parameters[parameter_name]
            if input.type == "mixed":
                assert isinstance(input.value, str)
                selectors = VariableTemplateParser(input.value).extract_variable_selectors()
                for selector in selectors:
                    result[selector.variable] = selector.value_selector
            elif input.type == "variable":
                result[parameter_name] = input.value
            elif input.type == "constant":
                pass

        result = {node_id + "." + key: value for key, value in result.items()}

        return result
