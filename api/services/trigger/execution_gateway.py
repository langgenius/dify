"""Hydrate the legacy generator's ORM inputs in a bounded repository read.

The shared generator still requires App/Workflow/actor models. Remove this
compatibility boundary when its invocation contract accepts detached values.
"""

from datetime import datetime
from typing import Protocol

from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from models.account import Account
from models.model import App, EndUser
from models.workflow import Workflow
from services.trigger.execution_layer import TriggerPostLayer
from services.trigger.execution_store import TriggerExecution, TriggerExecutionStore
from services.workflow_execution_identity import build_workflow_execution_identity
from services.workflow_run_agg import WorkflowRunAgg


class TriggerExecutionModels(Protocol):
    def get_execution_models(self, execution: TriggerExecution) -> tuple[App, Workflow, Account | EndUser]: ...


class WorkflowTriggerExecutionGateway:
    def __init__(
        self, *, models: TriggerExecutionModels, logs: TriggerExecutionStore, session_factory: sessionmaker[Session]
    ) -> None:
        self._models = models
        self._logs = logs
        self._session_factory = session_factory

    def run(self, execution: TriggerExecution, started_at: datetime) -> None:
        app_model, workflow, actor = self._models.get_execution_models(execution)
        generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
        generator.generate(
            app_model=app_model,
            workflow=workflow,
            user=actor,
            execution_identity=build_workflow_execution_identity(actor),
            args={"inputs": dict(execution.data.inputs), "files": list(execution.data.files)},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            call_depth=0,
            triggered_from=execution.data.trigger_from,
            root_node_id=execution.data.root_node_id,
            graph_engine_layers=[TriggerPostLayer(logs=self._logs, log=execution.log, start_time=started_at)],
            pause_state_config=PauseStateLayerConfig(
                session_factory=self._session_factory, state_owner_user_id=workflow.created_by
            ),
        )
