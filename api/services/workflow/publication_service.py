"""Publication policy over atomic persistence and Agent binding ports."""

import json

from core.trigger.constants import TRIGGER_NODE_TYPES
from core.workflow.nodes.knowledge_retrieval.entities import KnowledgeRetrievalNodeData
from libs.schedule_utils import calculate_next_run_at
from services.agent.publication_contracts import AgentPublicationState
from services.trigger.workflow_policy import plugin_relationships, schedule_config, webhook_node_ids
from services.workflow.contracts import (
    PublicationConfiguration,
    WorkflowBindingOperations,
    WorkflowPublicationTransaction,
    WorkflowSnapshot,
)


def prepare_publication(draft: WorkflowSnapshot) -> PublicationConfiguration:
    nodes = json.loads(draft.graph).get("nodes", [])
    dataset_ids: set[str] = set()
    for node in nodes:
        data = node.get("data", {})
        if data.get("type") == "knowledge-retrieval":
            try:
                dataset_ids.update(KnowledgeRetrievalNodeData.model_validate(data).dataset_ids)
            except ValueError:
                continue
    if draft.type != "workflow":
        return PublicationConfiguration(dataset_ids, [], [], None, [], False)
    schedule = schedule_config({"nodes": nodes})
    if schedule is not None:
        calculate_next_run_at(schedule.cron_expression, schedule.timezone)
    return PublicationConfiguration(
        dataset_ids=dataset_ids,
        webhook_nodes=webhook_node_ids(nodes),
        plugins=plugin_relationships(nodes),
        schedule=schedule,
        triggers=[
            {
                "node_id": node["id"],
                "node_type": node["data"]["type"],
                "node_title": node["data"].get("title", ""),
                "node_provider_name": node["data"].get("provider_name", ""),
            }
            for node in nodes
            if node.get("data", {}).get("type") in TRIGGER_NODE_TYPES
        ],
        has_trigger_runtime=True,
    )


def publish_workflow[BindingStore](
    transaction: WorkflowPublicationTransaction[BindingStore],
    configuration: PublicationConfiguration,
    *,
    agent_service: WorkflowBindingOperations,
    agents: AgentPublicationState,
    marked_name: str,
    marked_comment: str,
) -> WorkflowSnapshot:
    agent_service.validate_prepared_publication(draft_workflow=transaction.draft, prepared=agents)
    workflow = transaction.create_version(marked_name=marked_name, marked_comment=marked_comment)
    has_inline_agent = agent_service.copy_agent_node_bindings_to_published(
        draft_workflow=transaction.draft, published_workflow=workflow
    )
    if configuration.has_trigger_runtime:
        transaction.sync_webhooks(configuration.webhook_nodes)
        transaction.sync_plugins(configuration.plugins)
        transaction.sync_schedule(configuration.schedule)
        transaction.sync_triggers(configuration.triggers)
    transaction.sync_datasets(configuration.dataset_ids)
    transaction.activate(workflow)
    if has_inline_agent:
        transaction.track_inline_publish(workflow)
    return workflow
