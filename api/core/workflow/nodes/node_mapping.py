from collections.abc import Mapping

from core.workflow.nodes.agent.agent_node import AgentNode
from core.workflow.nodes.answer import AnswerNode
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.code import CodeNode
from core.workflow.nodes.document_extractor import DocumentExtractorNode
from core.workflow.nodes.end import EndNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.http_request import HttpRequestNode
from core.workflow.nodes.if_else import IfElseNode
from core.workflow.nodes.iteration import IterationNode, IterationStartNode
from core.workflow.nodes.knowledge_retrieval import KnowledgeRetrievalNode
from core.workflow.nodes.list_operator import ListOperatorNode
from core.workflow.nodes.llm import LLMNode
from core.workflow.nodes.loop import LoopEndNode, LoopNode, LoopStartNode
from core.workflow.nodes.parameter_extractor import ParameterExtractorNode
from core.workflow.nodes.question_classifier import QuestionClassifierNode
from core.workflow.nodes.start import StartNode
from core.workflow.nodes.template_transform import TemplateTransformNode
from core.workflow.nodes.tool import ToolNode
from core.workflow.nodes.variable_aggregator import VariableAggregatorNode
from core.workflow.nodes.variable_assigner.v1 import VariableAssignerNode as VariableAssignerNodeV1
from core.workflow.nodes.variable_assigner.v2 import VariableAssignerNode as VariableAssignerNodeV2

LATEST_VERSION = "latest"

NODE_TYPE_CLASSES_MAPPING: Mapping[NodeType, Mapping[str, type[BaseNode]]] = {
    NodeType.START: {
        LATEST_VERSION: StartNode,
        "1": StartNode,
    },
    NodeType.END: {
        LATEST_VERSION: EndNode,
        "1": EndNode,
    },
    NodeType.ANSWER: {
        LATEST_VERSION: AnswerNode,
        "1": AnswerNode,
    },
    NodeType.LLM: {
        LATEST_VERSION: LLMNode,
        "1": LLMNode,
    },
    NodeType.KNOWLEDGE_RETRIEVAL: {
        LATEST_VERSION: KnowledgeRetrievalNode,
        "1": KnowledgeRetrievalNode,
    },
    NodeType.IF_ELSE: {
        LATEST_VERSION: IfElseNode,
        "1": IfElseNode,
    },
    NodeType.CODE: {
        LATEST_VERSION: CodeNode,
        "1": CodeNode,
    },
    NodeType.TEMPLATE_TRANSFORM: {
        LATEST_VERSION: TemplateTransformNode,
        "1": TemplateTransformNode,
    },
    NodeType.QUESTION_CLASSIFIER: {
        LATEST_VERSION: QuestionClassifierNode,
        "1": QuestionClassifierNode,
    },
    NodeType.HTTP_REQUEST: {
        LATEST_VERSION: HttpRequestNode,
        "1": HttpRequestNode,
    },
    NodeType.TOOL: {
        LATEST_VERSION: ToolNode,
        "1": ToolNode,
    },
    NodeType.VARIABLE_AGGREGATOR: {
        LATEST_VERSION: VariableAggregatorNode,
        "1": VariableAggregatorNode,
    },
    NodeType.LEGACY_VARIABLE_AGGREGATOR: {
        LATEST_VERSION: VariableAggregatorNode,
        "1": VariableAggregatorNode,
    },  # original name of VARIABLE_AGGREGATOR
    NodeType.ITERATION: {
        LATEST_VERSION: IterationNode,
        "1": IterationNode,
    },
    NodeType.ITERATION_START: {
        LATEST_VERSION: IterationStartNode,
        "1": IterationStartNode,
    },
    NodeType.LOOP: {
        LATEST_VERSION: LoopNode,
        "1": LoopNode,
    },
    NodeType.LOOP_START: {
        LATEST_VERSION: LoopStartNode,
        "1": LoopStartNode,
    },
    NodeType.LOOP_END: {
        LATEST_VERSION: LoopEndNode,
        "1": LoopEndNode,
    },
    NodeType.PARAMETER_EXTRACTOR: {
        LATEST_VERSION: ParameterExtractorNode,
        "1": ParameterExtractorNode,
    },
    NodeType.VARIABLE_ASSIGNER: {
        LATEST_VERSION: VariableAssignerNodeV2,
        "1": VariableAssignerNodeV1,
        "2": VariableAssignerNodeV2,
    },
    NodeType.DOCUMENT_EXTRACTOR: {
        LATEST_VERSION: DocumentExtractorNode,
        "1": DocumentExtractorNode,
    },
    NodeType.LIST_OPERATOR: {
        LATEST_VERSION: ListOperatorNode,
        "1": ListOperatorNode,
    },
    NodeType.AGENT: {
        LATEST_VERSION: AgentNode,
        "1": AgentNode,
    },
}
