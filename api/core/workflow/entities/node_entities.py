from collections.abc import Mapping
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel

from models import WorkflowNodeExecutionStatus


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
    VARIABLE_AGGREGATOR = 'variable-aggregator'
    # TODO: merge this into VARIABLE_AGGREGATOR
    VARIABLE_ASSIGNER = 'variable-assigner'
    LOOP = 'loop'
    ITERATION = 'iteration'
    PARAMETER_EXTRACTOR = 'parameter-extractor'
    CONVERSATION_VARIABLE_ASSIGNER = 'assigner'

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


class NodeRunMetadataKey(Enum):
    """
    Node Run Metadata Key.
    """

    TOTAL_TOKENS = 'total_tokens'
    TOTAL_PRICE = 'total_price'
    CURRENCY = 'currency'
    TOOL_INFO = 'tool_info'
    ITERATION_ID = 'iteration_id'
    ITERATION_INDEX = 'iteration_index'


class NodeRunResult(BaseModel):
    """
    Node Run Result.
    """

    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING

    inputs: Optional[Mapping[str, Any]] = None  # node inputs
    process_data: Optional[dict] = None  # process data
    outputs: Optional[Mapping[str, Any]] = None  # node outputs
    metadata: Optional[dict[NodeRunMetadataKey, Any]] = None  # node metadata

    edge_source_handle: Optional[str] = None  # source handle id of node with multiple branches

    error: Optional[str] = None  # error message if status is failed
