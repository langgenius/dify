from core.workflow.entities.node_entities import NodeType
from core.workflow.nodes.answer.answer_node import AnswerNode
from core.workflow.nodes.code.code_node import CodeNode
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.http_request.http_request_node import HttpRequestNode
from core.workflow.nodes.if_else.if_else_node import IfElseNode
from core.workflow.nodes.iteration.iteration_node import IterationNode
from core.workflow.nodes.iteration.iteration_start_node import IterationStartNode
from core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node import KnowledgeRetrievalNode
from core.workflow.nodes.llm.llm_node import LLMNode
from core.workflow.nodes.parameter_extractor.parameter_extractor_node import ParameterExtractorNode
from core.workflow.nodes.question_classifier.question_classifier_node import QuestionClassifierNode
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode
from core.workflow.nodes.tool.tool_node import ToolNode
from core.workflow.nodes.variable_aggregator.variable_aggregator_node import VariableAggregatorNode
from core.workflow.nodes.variable_assigner import VariableAssignerNode

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
    NodeType.ITERATION_START: IterationStartNode,
    NodeType.PARAMETER_EXTRACTOR: ParameterExtractorNode,
    NodeType.CONVERSATION_VARIABLE_ASSIGNER: VariableAssignerNode,
}
