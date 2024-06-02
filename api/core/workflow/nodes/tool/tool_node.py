from os import path
from typing import Optional, cast

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.file.file_obj import FileTransferMethod, FileType, FileVar
from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter
from core.tools.tool.tool import Tool
from core.tools.tool_engine import ToolEngine
from core.tools.tool_manager import ToolManager
from core.tools.utils.message_transformer import ToolFileMessageTransformer
from core.workflow.entities.node_entities import NodeRunMetadataKey, NodeRunResult, NodeType, SystemVariable
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

        # get tool runtime
        try:
            tool_runtime = ToolManager.get_workflow_tool_runtime(
                self.tenant_id, self.app_id, self.node_id, node_data, self.invoke_from
            )
        except Exception as e:
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                inputs={},
                metadata={
                    NodeRunMetadataKey.TOOL_INFO: tool_info
                },
                error=f'Failed to get tool runtime: {str(e)}'
            )
        
        # get parameters
        parameters = self._generate_parameters(variable_pool, node_data, tool_runtime)

        try:
            messages = ToolEngine.workflow_invoke(
                tool=tool_runtime,
                tool_parameters=parameters,
                user_id=self.user_id,
                workflow_id=self.workflow_id, 
                workflow_tool_callback=DifyWorkflowCallbackHandler(),
                workflow_call_depth=self.workflow_call_depth,
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

    def _generate_parameters(self, variable_pool: VariablePool, node_data: ToolNodeData, tool_runtime: Tool) -> dict:
        """
            Generate parameters
        """
        tool_parameters = tool_runtime.get_all_runtime_parameters()

        def fetch_parameter(name: str) -> Optional[ToolParameter]:
            return next((parameter for parameter in tool_parameters if parameter.name == name), None)

        result = {}
        for parameter_name in node_data.tool_parameters:
            parameter = fetch_parameter(parameter_name)
            if not parameter:
                continue
            if parameter.type == ToolParameter.ToolParameterType.FILE:
                result[parameter_name] = [
                    v.to_dict() for v in self._fetch_files(variable_pool)
                ]
            else:
                input = node_data.tool_parameters[parameter_name]
                if input.type == 'mixed':
                    result[parameter_name] = self._format_variable_template(input.value, variable_pool)
                elif input.type == 'variable':
                    result[parameter_name] = variable_pool.get_variable_value(input.value)
                elif input.type == 'constant':
                    result[parameter_name] = input.value

        return result
    
    def _format_variable_template(self, template: str, variable_pool: VariablePool) -> str:
        """
        Format variable template
        """
        inputs = {}
        template_parser = VariableTemplateParser(template)
        for selector in template_parser.extract_variable_selectors():
            inputs[selector.variable] = variable_pool.get_variable_value(selector.value_selector)
        
        return template_parser.format(inputs)
    
    def _fetch_files(self, variable_pool: VariablePool) -> list[FileVar]:
        files = variable_pool.get_variable_value(['sys', SystemVariable.FILES.value])
        if not files:
            return []
        
        return files

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
        return '\n'.join([
            f'{message.message}' if message.type == ToolInvokeMessage.MessageType.TEXT else
            f'Link: {message.message}' if message.type == ToolInvokeMessage.MessageType.LINK else ''
            for message in tool_response
        ])
    

    @classmethod
    def _extract_variable_selector_to_variable_mapping(cls, node_data: ToolNodeData) -> dict[str, list[str]]:
        """
        Extract variable selector to variable mapping
        :param node_data: node data
        :return:
        """
        result = {}
        for parameter_name in node_data.tool_parameters:
            input = node_data.tool_parameters[parameter_name]
            if input.type == 'mixed':
                selectors = VariableTemplateParser(input.value).extract_variable_selectors()
                for selector in selectors:
                    result[selector.variable] = selector.value_selector
            elif input.type == 'variable':
                result[parameter_name] = input.value
            elif input.type == 'constant':
                pass

        return result
