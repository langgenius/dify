from os import path
from typing import cast

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.file.file_obj import FileTransferMethod, FileType, FileVar
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.entities.base_node_data_entities import BaseNodeData
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult, NodeType
from core.workflow.entities.variable_pool import VariablePool
from core.workflow.nodes.base_node import BaseNode
from core.workflow.nodes.tool.entities import ToolNodeData
from core.workflow.utils.variable_template_parser import VariableTemplateParser
from models.workflow import WorkflowNodeExecutionStatus


class ToolNode(BaseNode):
    """
    Tool Node
    """
    _node_data_cls = ToolNodeData
    _node_type = NodeType.TOOL

    def _run(self, variable_pool: VariablePool) -> NodeRunResult:
        """
        Run the tool node
        """

        node_data = cast(ToolNodeData, self.node_data)

        # fetch tool icon
        tool_info = {
            'provider_type': node_data.provider_type,
            'provider_id': node_data.provider_id
        }

        # get parameters
        parameters = self._generate_parameters(variable_pool, node_data)
        # get tool runtime
        try:
            tool_runtime = ToolManager.get_workflow_tool_runtime(self.tenant_id, node_data)
        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=parameters,
                metadata={
                    NodeRunMetadataKey.TOOL_INFO: tool_info
                },
                error=f'Failed to get tool runtime: {str(e)}'
            )

        try:
            messages = ToolEngine.workflow_invoke(
                tool=tool_runtime,
                tool_parameters=parameters,
                user_id=self.user_id,
                workflow_id=self.workflow_id, 
                workflow_tool_callback=DifyWorkflowCallbackHandler()
            )
        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs=parameters,
                metadata={
                    NodeRunMetadataKey.TOOL_INFO: tool_info
                },
                error=f'Failed to invoke tool: {str(e)}',
            )

        # convert tool messages
        plain_text, files = self._convert_tool_messages(messages)

        return NodeRunResult(
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            outputs={
                'text': plain_text,
                'files': files
            },
            metadata={
                NodeRunMetadataKey.TOOL_INFO: tool_info
            },
            inputs=parameters
        )

    def _generate_parameters(self, variable_pool: VariablePool, node_data: ToolNodeData) -> dict:
        """
            Generate parameters
        """
        result = {}
        for parameter in node_data.tool_parameters:
            if parameter.value_type == 'static':
                result[parameter.parameter_name] = parameter.static_value
            else:
                if isinstance(parameter.variable_value, str):
                    parser = VariableTemplateParser(parameter.variable_value)
                    variable_selectors = parser.extract_variable_selectors()
                    values = {
                        selector.variable: variable_pool.get_variable_value(selector)
                        for selector in variable_selectors
                    }

                    # if multiple values, use the parser to format the values into a string
                    result[parameter.parameter_name] = parser.format(values)
                elif isinstance(parameter.variable_value, list):
                    result[parameter.parameter_name] = variable_pool.get_variable_value(parameter.variable_value)

        return result

    def _convert_tool_messages(self, messages: list[ToolInvokeMessage]) -> tuple[str, list[FileVar]]:
        """
        Convert ToolInvokeMessages into tuple[plain_text, files]
        """
        # transform message and handle file storage
        messages = ToolFileMessageTransformer.transform_tool_invoke_messages(
            messages=messages,
            user_id=self.user_id,
            tenant_id=self.tenant_id,
            conversation_id=None,
        )
        # extract plain text and files
        files = self._extract_tool_response_binary(messages)
        plain_text = self._extract_tool_response_text(messages)

        return plain_text, files

    def _extract_tool_response_binary(self, tool_response: list[ToolInvokeMessage]) -> list[FileVar]:
        """
        Extract tool response binary
        """
        result = []

        for response in tool_response:
            if response.type == ToolInvokeMessage.MessageType.IMAGE_LINK or \
                    response.type == ToolInvokeMessage.MessageType.IMAGE:
                url = response.message
                ext = path.splitext(url)[1]
                mimetype = response.meta.get('mime_type', 'image/jpeg')
                filename = response.save_as or url.split('/')[-1]

                # get tool file id
                tool_file_id = url.split('/')[-1].split('.')[0]
                result.append(FileVar(
                    tenant_id=self.tenant_id,
                    type=FileType.IMAGE,
                    transfer_method=FileTransferMethod.TOOL_FILE,
                    related_id=tool_file_id,
                    filename=filename,
                    extension=ext,
                    mime_type=mimetype,
                ))
            elif response.type == ToolInvokeMessage.MessageType.BLOB:
                # get tool file id
                tool_file_id = response.message.split('/')[-1].split('.')[0]
                result.append(FileVar(
                    tenant_id=self.tenant_id,
                    type=FileType.IMAGE,
                    transfer_method=FileTransferMethod.TOOL_FILE,
                    related_id=tool_file_id,
                    filename=response.save_as,
                    extension=path.splitext(response.save_as)[1],
                    mime_type=response.meta.get('mime_type', 'application/octet-stream'),
                ))
            elif response.type == ToolInvokeMessage.MessageType.LINK:
                pass  # TODO:

        return result

    def _extract_tool_response_text(self, tool_response: list[ToolInvokeMessage]) -> str:
        """
        Extract tool response text
        """
        return ''.join([
            f'{message.message}\n' if message.type == ToolInvokeMessage.MessageType.TEXT else
            f'Link: {message.message}\n' if message.type == ToolInvokeMessage.MessageType.LINK else ''
            for message in tool_response
        ])

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: BaseNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        return {}