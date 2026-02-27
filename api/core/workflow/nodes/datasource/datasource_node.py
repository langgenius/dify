from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecutionStatus
from core.workflow.enums import NodeExecutionType, NodeType, SystemVariableKey
from core.workflow.node_events import NodeRunResult, StreamCompletedEvent
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.base.variable_template_parser import VariableTemplateParser
from core.workflow.repositories.datasource_manager_protocol import (
    DatasourceManagerProtocol,
    DatasourceParameter,
    OnlineDriveDownloadFileParam,
)

from ...entities.workflow_node_execution import WorkflowNodeExecutionMetadataKey
from .entities import DatasourceNodeData
from .exc import DatasourceNodeError

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState


class DatasourceNode(Node[DatasourceNodeData]):
    """
    Datasource Node
    """

    node_type = NodeType.DATASOURCE
    execution_type = NodeExecutionType.ROOT

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        datasource_manager: DatasourceManagerProtocol,
    ):
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self.datasource_manager = datasource_manager

    def _run(self) -> Generator:
        """
        Run the datasource node
        """

        node_data = self.node_data
        variable_pool = self.graph_runtime_state.variable_pool
        datasource_type_segment = variable_pool.get(["sys", SystemVariableKey.DATASOURCE_TYPE])
        if not datasource_type_segment:
            raise DatasourceNodeError("Datasource type is not set")
        datasource_type = str(datasource_type_segment.value) if datasource_type_segment.value else None
        datasource_info_segment = variable_pool.get(["sys", SystemVariableKey.DATASOURCE_INFO])
        if not datasource_info_segment:
            raise DatasourceNodeError("Datasource info is not set")
        datasource_info_value = datasource_info_segment.value
        if not isinstance(datasource_info_value, dict):
            raise DatasourceNodeError("Invalid datasource info format")
        datasource_info: dict[str, Any] = datasource_info_value

        if datasource_type is None:
            raise DatasourceNodeError("Datasource type is not set")

        datasource_type = DatasourceProviderType.value_of(datasource_type)
        provider_id = f"{node_data.plugin_id}/{node_data.provider_name}"

        datasource_info["icon"] = self.datasource_manager.get_icon_url(
            provider_id=provider_id,
            datasource_name=node_data.datasource_name or "",
            tenant_id=self.tenant_id,
            datasource_type=datasource_type.value,
        )

        parameters_for_log = datasource_info

        try:
            match datasource_type:
                case DatasourceProviderType.ONLINE_DOCUMENT | DatasourceProviderType.ONLINE_DRIVE:
                    # Build typed request objects
                    datasource_parameters = None
                    if datasource_type == DatasourceProviderType.ONLINE_DOCUMENT:
                        datasource_parameters = DatasourceParameter(
                            workspace_id=datasource_info.get("workspace_id", ""),
                            page_id=datasource_info.get("page", {}).get("page_id", ""),
                            type=datasource_info.get("page", {}).get("type", ""),
                        )

                    online_drive_request = None
                    if datasource_type == DatasourceProviderType.ONLINE_DRIVE:
                        online_drive_request = OnlineDriveDownloadFileParam(
                            id=datasource_info.get("id", ""),
                            bucket=datasource_info.get("bucket", ""),
                        )

                    credential_id = datasource_info.get("credential_id", "")

                    yield from self.datasource_manager.stream_node_events(
                        node_id=self._node_id,
                        user_id=self.user_id,
                        datasource_name=node_data.datasource_name or "",
                        datasource_type=datasource_type.value,
                        provider_id=provider_id,
                        tenant_id=self.tenant_id,
                        provider=node_data.provider_name,
                        plugin_id=node_data.plugin_id,
                        credential_id=credential_id,
                        parameters_for_log=parameters_for_log,
                        datasource_info=datasource_info,
                        variable_pool=variable_pool,
                        datasource_param=datasource_parameters,
                        online_drive_request=online_drive_request,
                    )
                case DatasourceProviderType.WEBSITE_CRAWL:
                    yield StreamCompletedEvent(
                        node_run_result=NodeRunResult(
                            status=WorkflowNodeExecutionStatus.SUCCEEDED,
                            inputs=parameters_for_log,
                            metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                            outputs={
                                **datasource_info,
                                "datasource_type": datasource_type,
                            },
                        )
                    )
                case DatasourceProviderType.LOCAL_FILE:
                    related_id = datasource_info.get("related_id")
                    if not related_id:
                        raise DatasourceNodeError("File is not exist")

                    file_info = self.datasource_manager.get_upload_file_by_id(
                        file_id=related_id, tenant_id=self.tenant_id
                    )
                    variable_pool.add([self._node_id, "file"], file_info)
                    # variable_pool.add([self.node_id, "file"], file_info.to_dict())
                    yield StreamCompletedEvent(
                        node_run_result=NodeRunResult(
                            status=WorkflowNodeExecutionStatus.SUCCEEDED,
                            inputs=parameters_for_log,
                            metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                            outputs={
                                "file": file_info,
                                "datasource_type": datasource_type,
                            },
                        )
                    )
                case _:
                    raise DatasourceNodeError(f"Unsupported datasource provider: {datasource_type}")
        except PluginDaemonClientSideError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to transform datasource message: {str(e)}",
                    error_type=type(e).__name__,
                )
            )
        except DatasourceNodeError as e:
            yield StreamCompletedEvent(
                node_run_result=NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    inputs=parameters_for_log,
                    metadata={WorkflowNodeExecutionMetadataKey.DATASOURCE_INFO: datasource_info},
                    error=f"Failed to invoke datasource: {str(e)}",
                    error_type=type(e).__name__,
                )
            )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        """
        Extract variable selector to variable mapping
        :param graph_config: graph config
        :param node_id: node id
        :param node_data: node data
        :return:
        """
        typed_node_data = DatasourceNodeData.model_validate(node_data)
        result = {}
        if typed_node_data.datasource_parameters:
            for parameter_name in typed_node_data.datasource_parameters:
                input = typed_node_data.datasource_parameters[parameter_name]
                match input.type:
                    case "mixed":
                        assert isinstance(input.value, str)
                        selectors = VariableTemplateParser(input.value).extract_variable_selectors()
                        for selector in selectors:
                            result[selector.variable] = selector.value_selector
                    case "variable":
                        result[parameter_name] = input.value
                    case "constant":
                        pass
                    case None:
                        pass

            result = {node_id + "." + key: value for key, value in result.items()}

        return result

    @classmethod
    def version(cls) -> str:
        return "1"
