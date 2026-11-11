"""Execute plugin callbacks into standalone workflow nodes."""

from graphon.enums import BuiltinNodeTypes
from graphon.nodes.llm.entities import ModelConfig as LLMModelConfig
from graphon.nodes.parameter_extractor.entities import ParameterConfig, ParameterExtractorNodeData
from graphon.nodes.question_classifier.entities import ClassConfig, QuestionClassifierNodeData
from services.knowledge.retrieval.retrieval import KnowledgeRetriever
from services.workflow_service import WorkflowService


class PluginNodeInvocationService:
    """Invoke nodes with workflow and retrieval dependencies bound at construction."""

    def __init__(self, *, workflow: WorkflowService, knowledge_retrieval: KnowledgeRetriever) -> None:
        self._workflow = workflow
        self._knowledge_retrieval = knowledge_retrieval

    def invoke_parameter_extractor(
        self,
        tenant_id: str,
        user_id: str,
        parameters: list[ParameterConfig],
        model_config: LLMModelConfig,
        instruction: str,
        query: str,
    ) -> dict[str, object]:
        node_id = "1919810"
        node_data = ParameterExtractorNodeData(
            title="parameter_extractor",
            desc="parameter_extractor",
            parameters=parameters,
            reasoning_mode="function_call",
            query=[node_id, "query"],
            model=model_config,
            instruction=instruction,  # instructions with variables are not supported
        )
        node_data_dict = node_data.model_dump()
        node_data_dict["type"] = BuiltinNodeTypes.PARAMETER_EXTRACTOR
        execution = self._workflow.run_free_workflow_node(
            node_data_dict,
            tenant_id=tenant_id,
            user_id=user_id,
            node_id=node_id,
            user_inputs={f"{node_id}.query": query},
            knowledge_retrieval=self._knowledge_retrieval,
        )
        return {
            "inputs": execution.inputs,
            "outputs": execution.outputs,
            "process_data": execution.process_data,
        }

    def invoke_question_classifier(
        self,
        tenant_id: str,
        user_id: str,
        model_config: LLMModelConfig,
        classes: list[ClassConfig],
        instruction: str,
        query: str,
    ) -> dict[str, object]:
        node_id = "1919810"
        node_data = QuestionClassifierNodeData(
            title="question_classifier",
            desc="question_classifier",
            query_variable_selector=[node_id, "query"],
            model=model_config,
            classes=classes,
            instruction=instruction,  # instructions with variables are not supported
        )
        execution = self._workflow.run_free_workflow_node(
            node_data.model_dump(),
            tenant_id=tenant_id,
            user_id=user_id,
            node_id=node_id,
            user_inputs={f"{node_id}.query": query},
            knowledge_retrieval=self._knowledge_retrieval,
        )
        return {
            "inputs": execution.inputs,
            "outputs": execution.outputs,
            "process_data": execution.process_data,
        }
