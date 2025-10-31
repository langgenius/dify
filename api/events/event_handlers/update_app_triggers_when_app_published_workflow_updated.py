from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes import NodeType
from events.app_event import app_published_workflow_was_updated
from extensions.ext_database import db
from models import AppMode
from models.enums import AppTriggerStatus
from models.trigger import AppTrigger
from models.workflow import Workflow


@app_published_workflow_was_updated.connect
def handle(sender, **kwargs):
    """
    Handle app published workflow update event to sync app_triggers table.

    When a workflow is published, this handler will:
    1. Extract trigger nodes from the workflow graph
    2. Compare with existing app_triggers records
    3. Add new triggers and remove obsolete ones
    """
    app = sender
    if app.mode != AppMode.WORKFLOW.value:
        return

    published_workflow = kwargs.get("published_workflow")
    published_workflow = cast(Workflow, published_workflow)
    # Extract trigger info from workflow
    trigger_infos = get_trigger_infos_from_workflow(published_workflow)

    with Session(db.engine) as session:
        # Get existing app triggers
        existing_triggers = (
            session.execute(
                select(AppTrigger).where(AppTrigger.tenant_id == app.tenant_id, AppTrigger.app_id == app.id)
            )
            .scalars()
            .all()
        )

        # Convert existing triggers to dict for easy lookup
        existing_triggers_map = {trigger.node_id: trigger for trigger in existing_triggers}

        # Get current and new node IDs
        existing_node_ids = set(existing_triggers_map.keys())
        new_node_ids = {info["node_id"] for info in trigger_infos}

        # Calculate changes
        added_node_ids = new_node_ids - existing_node_ids
        removed_node_ids = existing_node_ids - new_node_ids

        # Remove obsolete triggers
        for node_id in removed_node_ids:
            session.delete(existing_triggers_map[node_id])

        for trigger_info in trigger_infos:
            node_id = trigger_info["node_id"]

            if node_id in added_node_ids:
                # Create new trigger
                app_trigger = AppTrigger(
                    tenant_id=app.tenant_id,
                    app_id=app.id,
                    trigger_type=trigger_info["node_type"],
                    title=trigger_info["node_title"],
                    node_id=node_id,
                    provider_name=trigger_info.get("node_provider_name", ""),
                    status=AppTriggerStatus.ENABLED,
                )
                session.add(app_trigger)
            elif node_id in existing_node_ids:
                # Update existing trigger if needed
                existing_trigger = existing_triggers_map[node_id]
                new_title = trigger_info["node_title"]
                if new_title and existing_trigger.title != new_title:
                    existing_trigger.title = new_title
                    session.add(existing_trigger)

        session.commit()


def get_trigger_infos_from_workflow(published_workflow: Workflow) -> list[dict]:
    """
    Extract trigger node information from the workflow graph.

    Returns:
        List of trigger info dictionaries containing:
        - node_type: The type of the trigger node ('trigger-webhook', 'trigger-schedule', 'trigger-plugin')
        - node_id: The node ID in the workflow
        - node_title: The title of the node
        - node_provider_name: The name of the node's provider, only for plugin
    """
    graph = published_workflow.graph_dict
    if not graph:
        return []

    nodes = graph.get("nodes", [])
    trigger_types = {NodeType.TRIGGER_WEBHOOK.value, NodeType.TRIGGER_SCHEDULE.value, NodeType.TRIGGER_PLUGIN.value}

    trigger_infos = [
        {
            "node_type": node.get("data", {}).get("type"),
            "node_id": node.get("id"),
            "node_title": node.get("data", {}).get("title"),
            "node_provider_name": node.get("data", {}).get("provider_name"),
        }
        for node in nodes
        if node.get("data", {}).get("type") in trigger_types
    ]

    return trigger_infos
