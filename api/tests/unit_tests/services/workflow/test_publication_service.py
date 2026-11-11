from __future__ import annotations

from dataclasses import replace
from unittest.mock import Mock, create_autospec

from repositories.workflow.definition_repository import workflow_snapshot
from services.agent.publication_contracts import AgentPublicationState
from services.workflow.contracts import (
    PublicationConfiguration,
    WorkflowBindingOperations,
    WorkflowPublicationTransaction,
)
from services.workflow.publication_service import publish_workflow
from tests.helpers.unit.model_factories import make_workflow


def test_publish_syncs_knowledge_spaces_after_agent_bindings_and_before_activation() -> None:
    draft = workflow_snapshot(make_workflow(workflow_id="draft"))
    published = replace(draft, id="published", version="1")
    transaction = create_autospec(WorkflowPublicationTransaction, instance=True, spec_set=True)
    transaction.draft = draft
    transaction.create_version.return_value = published
    agents: AgentPublicationState = ()
    agent_service = create_autospec(WorkflowBindingOperations, instance=True, spec_set=True)
    calls = Mock()
    calls.attach_mock(agent_service, "agents")
    calls.attach_mock(transaction, "transaction")

    result = publish_workflow(
        transaction,
        PublicationConfiguration(
            dataset_ids={"dataset"},
            webhook_nodes=["webhook"],
            plugins=[{"provider": "plugin"}],
            schedule=None,
            triggers=[{"node_id": "trigger"}],
            has_trigger_runtime=True,
        ),
        agent_service=agent_service,
        agents=agents,
        marked_name="Release",
        marked_comment="Ready",
    )

    assert result is published
    transaction.sync_knowledge_spaces.assert_called_once_with(published)
    call_names = [entry[0] for entry in calls.mock_calls]
    assert call_names.index("agents.copy_agent_node_bindings_to_published") < call_names.index(
        "transaction.sync_knowledge_spaces"
    )
    assert call_names.index("transaction.sync_knowledge_spaces") < call_names.index("transaction.activate")
