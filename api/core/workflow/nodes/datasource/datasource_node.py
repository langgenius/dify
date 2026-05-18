from collections.abc import Generator, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.datasource.datasource_manager import DatasourceManager
from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.workflow.file_reference import resolve_file_record_id
from core.workflow.system_variables import SystemVariableKey, get_system_segment
from graphon.enums import (
    BuiltinNodeTypes,
    NodeExecutionType,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.node_events import NodeRunResult, StreamCompletedEvent
from graphon.nodes.base.node import Node
from graphon.nodes.base.variable_template_parser import VariableTemplateParser

from .entities import DatasourceNodeData, DatasourceParameter, OnlineDriveDownloadFileParam
from .exc import DatasourceNodeError

if TYPE_CHECKING:
    from graphon.entities import GraphInitParams
    from graphon.runtime import GraphRuntimeState


class DatasourceNode(Node[DatasourceNodeData]):
    """
    Datasource Node
    """

    node_type = BuiltinNodeTypes.DATASOURCE
    execution_type = NodeExecutionType.ROOT

    def __init__(
        self,
        node_id: str,
        data: DatasourceNodeData,
        *,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self.datasource_manager = DatasourceManager

    def populate_start_event(self, event) -> None:
        event.provider_id = f"{self.node_data.plugin_id}/{self.node_data.provider_name}"
        event.provider_type = self.node_data.provider_type

    def _run(self) -> Generator:
        """
        Run the datasource node
        """
        dify_ctx = DifyRunContext.model_validate(self.require_run_context_value(DIFY_RUN_CONTEXT_KEY))
        node_data = self.node_data
        variable_pool = self.graph_runtime_state.variable_pool
        datasource_type_segment = get_system_segment(variable_pool, SystemVariableKey.DATASOURCE_TYPE)
        if not datasource_type_segment:
            raise DatasourceNodeError("Datasource type is not set")
        datasource_type = str(datasource_type_segment.value) if datasource_type_segment.value else None
        datasource_info_segment = get_system_segment(variable_pool, SystemVariableKey.DATASOURCE_INFO)
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
            tenant_id=dify_ctx.tenant_id,
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
                        user_id=dify_ctx.user_id,
                        datasource_name=node_data.datasource_name or "",
                        datasource_type=datasource_type.value,
                        provider_id=provider_id,
                        tenant_id=dify_ctx.tenant_id,
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
                    file_id = resolve_file_record_id(
                        datasource_info.get("reference") or datasource_info.get("related_id")
                    )
                    if not file_id:
                        raise DatasourceNodeError("File is not exist")

                    file_info = self.datasource_manager.get_upload_file_by_id(
                        file_id=file_id, tenant_id=dify_ctx.tenant_id
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
        if node_data.datasource_parameters:
            for parameter_name in node_data.datasource_parameters:
                input = node_data.datasource_parameters[parameter_name]
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
