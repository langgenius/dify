from core.plugin.backwards_invocation.base import BaseBackwardsInvocation
from core.workflow.nodes.parameter_extractor.entities import (
    ModelConfig as ParameterExtractorModelConfig,
)
from core.workflow.nodes.parameter_extractor.entities import (
    ParameterConfig,
    ParameterExtractorNodeData,
)
from core.workflow.nodes.question_classifier.entities import (
    ClassConfig,
    QuestionClassifierNodeData,
)
from core.workflow.nodes.question_classifier.entities import (
    ModelConfig as QuestionClassifierModelConfig,
)
from services.workflow_service import WorkflowService


class PluginNodeBackwardsInvocation(BaseBackwardsInvocation):
    @classmethod
    def invoke_parameter_extractor(
        cls,
        tenant_id: str,
        user_id: str,
        parameters: list[ParameterConfig],
        model_config: ParameterExtractorModelConfig,
        instruction: str,
        query: str,
    ) -> dict:
        """
        Invoke parameter extractor node.

        :param tenant_id: str
        :param user_id: str
        :param parameters: list[ParameterConfig]
        :param model_config: ModelConfig
        :param instruction: str
        :param query: str
        :return: dict with __reason, __is_success, and other parameters
        """
        workflow_service = WorkflowService()
        node_id = "1919810"
        node_data = ParameterExtractorNodeData(
            title="parameter_extractor",
            desc="parameter_extractor",
            parameters=parameters,
            reasoning_mode="function_call",
            query=[node_id, "query"],
            model=model_config,
            instruction=instruction,  # instruct with variables are not supported
        )
        node_data_dict = node_data.model_dump()
        execution = workflow_service.run_free_workflow_node(
            node_data_dict,
            tenant_id=tenant_id,
            user_id=user_id,
            node_id=node_id,
            user_inputs={
                f"{node_id}.query": query,
            },
        )

        output = execution.outputs_dict
        return output or {
            "__reason": "No parameters extracted",
            "__is_success": False,
        }

    @classmethod
    def invoke_question_classifier(
        cls,
        tenant_id: str,
        user_id: str,
        model_config: QuestionClassifierModelConfig,
        classes: list[ClassConfig],
        instruction: str,
        query: str,
    ) -> dict:
        """
        Invoke question classifier node.

        :param tenant_id: str
        :param user_id: str
        :param model_config: ModelConfig
        :param classes: list[ClassConfig]
        :param instruction: str
        :param query: str
        :return: dict with class_name
        """
        workflow_service = WorkflowService()
        node_id = "1919810"
        node_data = QuestionClassifierNodeData(
            title="question_classifier",
            desc="question_classifier",
            query_variable_selector=[node_id, "query"],
            model=model_config,
            classes=classes,
            instruction=instruction,  # instruct with variables are not supported
        )
        node_data_dict = node_data.model_dump()
        execution = workflow_service.run_free_workflow_node(
            node_data_dict,
            tenant_id=tenant_id,
            user_id=user_id,
            node_id=node_id,
            user_inputs={
                f"{node_id}.query": query,
            },
        )

        output = execution.outputs_dict
        return output or {
            "class_name": classes[0].name,
        }
