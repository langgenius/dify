from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel

from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.code.code_node import CodeNode
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.http_request.http_request_node import HttpRequestNode
from core.workflow.nodes.if_else.if_else_node import IfElseNode
from core.workflow.nodes.iteration.iteration_node import IterationNode
from core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node import KnowledgeRetrievalNode
from core.workflow.nodes.llm.llm_node import LLMNode
from core.workflow.nodes.parameter_extractor.parameter_extractor_node import ParameterExtractorNode
from core.workflow.nodes.question_classifier.question_classifier_node import QuestionClassifierNode
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode
from core.workflow.nodes.tool.tool_node import ToolNode
from core.workflow.nodes.variable_aggregator.variable_aggregator_node import VariableAggregatorNode
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
    VARIABLE_AGGREGATOR = 'variable-aggregator'
    VARIABLE_ASSIGNER = 'variable-assigner'
    LOOP = 'loop'
    ITERATION = 'iteration'
    PARAMETER_EXTRACTOR = 'parameter-extractor'

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


node_classes = {
    NodeType.START: StartNode,
    NodeType.END: EndNode,
    NodeType.ANSWER: AnswerNode,
    NodeType.LLM: LLMNode,
    NodeType.KNOWLEDGE_RETRIEVAL: KnowledgeRetrievalNode,
    NodeType.IF_ELSE: IfElseNode,
    NodeType.CODE: CodeNode,
    NodeType.TEMPLATE_TRANSFORM: TemplateTransformNode,
    NodeType.QUESTION_CLASSIFIER: QuestionClassifierNode,
    NodeType.HTTP_REQUEST: HttpRequestNode,
    NodeType.TOOL: ToolNode,
    NodeType.VARIABLE_AGGREGATOR: VariableAggregatorNode,
    NodeType.VARIABLE_ASSIGNER: VariableAggregatorNode,  # original name of VARIABLE_AGGREGATOR
    NodeType.ITERATION: IterationNode,
    NodeType.PARAMETER_EXTRACTOR: ParameterExtractorNode
}


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
    ITERATION_ID = 'iteration_id'
    ITERATION_INDEX = 'iteration_index'


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
