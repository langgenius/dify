from graphon.nodes.human_input.entities import FormInput, UserAction
from graphon.nodes.human_input.enums import FormInputType

from core.entities.execution_extra_content import (
    ExecutionExtraContentDomainModel,
    HumanInputContent,
    HumanInputFormDefinition,
    HumanInputFormSubmissionData,
)
from models.execution_extra_content import ExecutionContentType


def test_human_input_content_defaults_and_domain_alias() -> None:
    # Arrange
    form_definition = HumanInputFormDefinition(
        form_id="form-1",
        node_id="node-1",
        node_title="Human Input",
        form_content="Please confirm",
        inputs=[FormInput(type=FormInputType.TEXT_INPUT, output_variable_name="answer")],
        actions=[UserAction(id="confirm", title="Confirm")],
        resolved_default_values={"answer": "yes"},
        expiration_time=1_700_000_000,
    )
    submission_data = HumanInputFormSubmissionData(
        node_id="node-1",
        node_title="Human Input",
        rendered_content="Please confirm",
        action_id="confirm",
        action_text="Confirm",
    )

    # Act
    content = HumanInputContent(
        workflow_run_id="workflow-run-1",
        submitted=True,
        form_definition=form_definition,
        form_submission_data=submission_data,
    )

    # Assert
    assert form_definition.model_config.get("frozen") is True
    assert content.type == ExecutionContentType.HUMAN_INPUT
    assert content.form_definition is form_definition
    assert content.form_submission_data is submission_data
    assert ExecutionExtraContentDomainModel is HumanInputContent
