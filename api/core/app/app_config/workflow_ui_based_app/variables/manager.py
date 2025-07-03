from core.app.app_config.entities import RagPipelineVariableEntity, VariableEntity
from models.workflow import Workflow


class WorkflowVariablesConfigManager:
    @classmethod
    def convert(cls, workflow: Workflow) -> list[VariableEntity]:
        """
        Convert workflow start variables to variables

        :param workflow: workflow instance
        """
        variables = []

        # find start node
        user_input_form = workflow.user_input_form()

        # variables
        for variable in user_input_form:
            variables.append(VariableEntity.model_validate(variable))

        return variables

    @classmethod
    def convert_rag_pipeline_variable(cls, workflow: Workflow) -> list[RagPipelineVariableEntity]:
        """
        Convert workflow start variables to variables

        :param workflow: workflow instance
        """
        variables = []

        user_input_form = workflow.rag_pipeline_user_input_form()
        # variables
        for variable in user_input_form:
            variables.append(RagPipelineVariableEntity.model_validate(variable))

        return variables
