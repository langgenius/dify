"""SQL visibility predicate shared by Console app persistence adapters."""

from sqlalchemy import ColumnElement, exists, or_

from models.agent import Agent, AgentScope
from models.model import App, AppMode


def console_visible_condition() -> ColumnElement[bool]:
    """Exclude workflow-only Agents' runtime backing Apps, including archived Agents.

    Console must address these Apps through their owning workflow.
    """
    backs_workflow_only_agent = exists().where(
        Agent.tenant_id == App.tenant_id,
        Agent.backing_app_id == App.id,
        Agent.scope == AgentScope.WORKFLOW_ONLY,
    )
    return or_(App.mode != AppMode.AGENT, ~backs_workflow_only_agent)
