from unittest.mock import Mock

import pytest

from models.human_input_contracts import FormCreateParams
from models.human_input_entities import HumanInputNodeData, UserActionConfig
from repositories.human_input.form_repository import HumanInputFormRepositoryImpl


@pytest.mark.parametrize("conversation_id", ["conversation-id", None])
def test_runtime_form_requires_workflow_execution_id(conversation_id: str | None) -> None:
    sessions = Mock(name="sessions")
    repository = HumanInputFormRepositoryImpl(
        tenant_id="tenant-id",
        app_id="app-id",
        sessions=sessions,
    )
    params = FormCreateParams(
        workflow_execution_id=None,
        conversation_id=conversation_id,
        node_id="node-id",
        form_config=HumanInputNodeData(
            title="Approval",
            delivery_methods=[],
            form_content="Approve this request?",
            inputs=[],
            user_actions=[UserActionConfig(id="approve", title="Approve")],
        ),
        rendered_content="Approve this request?",
        delivery_methods=[],
        display_in_ui=True,
        resolved_default_values={},
    )

    with pytest.raises(ValueError, match="^a runtime human input form requires a workflow_execution_id$"):
        repository.create_form(params)

    sessions.assert_not_called()
