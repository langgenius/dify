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
from core.workflow.nodes.parameter_extractor import ParameterExtractorNode
from core.workflow.nodes.question_classifier import QuestionClassifierNode
from core.workflow.nodes.start import StartNode
from core.workflow.nodes.template_transform import TemplateTransformNode
from core.workflow.nodes.tool import ToolNode
from core.workflow.nodes.variable_aggregator import VariableAggregatorNode
from core.workflow.nodes.variable_assigner import VariableAssignerNode

node_type_classes_mapping: dict[NodeType, type[BaseNode]] = {
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
    NodeType.ITERATION_START: IterationStartNode,
    NodeType.PARAMETER_EXTRACTOR: ParameterExtractorNode,
    NodeType.CONVERSATION_VARIABLE_ASSIGNER: VariableAssignerNode,
    NodeType.DOCUMENT_EXTRACTOR: DocumentExtractorNode,
    NodeType.LIST_OPERATOR: ListOperatorNode,
}
