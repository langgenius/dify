from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel

from core.model_runtime.entities.llm_entities import LLMUsage
from models import WorkflowNodeExecutionStatus


class NodeType(Enum):
    """
    Node Types.
    """

    START = "start"
    END = "end"
    ANSWER = "answer"
    LLM = "llm"
    KNOWLEDGE_RETRIEVAL = "knowledge-retrieval"
    IF_ELSE = "if-else"
    CODE = "code"
    TEMPLATE_TRANSFORM = "template-transform"
    QUESTION_CLASSIFIER = "question-classifier"
    HTTP_REQUEST = "http-request"
    TOOL = "tool"
    VARIABLE_AGGREGATOR = "variable-aggregator"
    # TODO: merge this into VARIABLE_AGGREGATOR
    VARIABLE_ASSIGNER = "variable-assigner"
    LOOP = "loop"
    ITERATION = "iteration"
    ITERATION_START = "iteration-start"  # fake start node for iteration
    PARAMETER_EXTRACTOR = "parameter-extractor"
    CONVERSATION_VARIABLE_ASSIGNER = "assigner"

    @classmethod
    def value_of(cls, value: str) -> "NodeType":
        """
        Get value of given node type.

        :param value: node type value
        :return: node type
        """
        for node_type in cls:
            if node_type.value == value:
                return node_type
        raise ValueError(f"invalid node type value {value}")


class NodeRunMetadataKey(Enum):
    """
    Node Run Metadata Key.
    """

    TOTAL_TOKENS = "total_tokens"
    TOTAL_PRICE = "total_price"
    CURRENCY = "currency"
    TOOL_INFO = "tool_info"
    ITERATION_ID = "iteration_id"
    ITERATION_INDEX = "iteration_index"
    PARALLEL_ID = "parallel_id"
    PARALLEL_START_NODE_ID = "parallel_start_node_id"
    PARENT_PARALLEL_ID = "parent_parallel_id"
    PARENT_PARALLEL_START_NODE_ID = "parent_parallel_start_node_id"


class NodeRunResult(BaseModel):
    """
    Node Run Result.
    """

    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING

    inputs: Optional[dict[str, Any]] = None  # node inputs
    process_data: Optional[dict[str, Any]] = None  # process data
    outputs: Optional[dict[str, Any]] = None  # node outputs
    metadata: Optional[dict[NodeRunMetadataKey, Any]] = None  # node metadata
    llm_usage: Optional[LLMUsage] = None  # llm usage

    edge_source_handle: Optional[str] = None  # source handle id of node with multiple branches

    error: Optional[str] = None  # error message if status is failed


class UserFrom(Enum):
    """
    User from
    """

    ACCOUNT = "account"
    END_USER = "end-user"

    @classmethod
    def value_of(cls, value: str) -> "UserFrom":
        """
        Value of
        :param value: value
        :return:
        """
        for item in cls:
            if item.value == value:
                return item
        raise ValueError(f"Invalid value: {value}")
