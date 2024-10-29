from core.app.app_config.entities import VariableEntity
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
