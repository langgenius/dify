from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel

from models.workflow import WorkflowNodeExecutionStatus


class NodeType(Enum):
    """
    Node Types.
    """
    START = 'start'
    END = 'end'
    ANSWER = 'answer'
    LLM = 'llm'
    KNOWLEDGE_RETRIEVAL = 'knowledge-retrieval'
    IF_ELSE = 'if-else'
    CODE = 'code'
    TEMPLATE_TRANSFORM = 'template-transform'
    QUESTION_CLASSIFIER = 'question-classifier'
    HTTP_REQUEST = 'http-request'
    TOOL = 'tool'
    VARIABLE_ASSIGNER = 'variable-assigner'

    @classmethod
    def value_of(cls, value: str) -> 'NodeType':
        """
        Get value of given node type.

        :param value: node type value
        :return: node type
        """
        for node_type in cls:
            if node_type.value == value:
                return node_type
        raise ValueError(f'invalid node type value {value}')


class SystemVariable(Enum):
    """
    System Variables.
    """
    QUERY = 'query'
    FILES = 'files'
    CONVERSATION_ID = 'conversation_id'
    USER_ID = 'user_id'

    @classmethod
    def value_of(cls, value: str) -> 'SystemVariable':
        """
        Get value of given system variable.

        :param value: system variable value
        :return: system variable
        """
        for system_variable in cls:
            if system_variable.value == value:
                return system_variable
        raise ValueError(f'invalid system variable value {value}')


class NodeRunMetadataKey(Enum):
    """
    Node Run Metadata Key.
    """
    TOTAL_TOKENS = 'total_tokens'
    TOTAL_PRICE = 'total_price'
    CURRENCY = 'currency'
    TOOL_INFO = 'tool_info'


class NodeRunResult(BaseModel):
    """
    Node Run Result.
    """
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING

    inputs: Optional[dict] = None  # node inputs
    process_data: Optional[dict] = None  # process data
    outputs: Optional[dict] = None  # node outputs
    metadata: Optional[dict[NodeRunMetadataKey, Any]] = None  # node metadata

    edge_source_handle: Optional[str] = None  # source handle id of node with multiple branches

    error: Optional[str] = None  # error message if status is failed
