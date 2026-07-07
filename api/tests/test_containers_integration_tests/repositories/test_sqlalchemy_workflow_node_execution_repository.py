"""Testcontainers integration tests for SQLAlchemyWorkflowNodeExecutionRepository."""

from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories import SQLAlchemyWorkflowNodeExecutionRepository
from core.repositories.factory import OrderConfig
from graphon.entities import WorkflowNodeExecution
from graphon.enums import (
    BuiltinNodeTypes,
    WorkflowNodeExecutionMetadataKey,
    WorkflowNodeExecutionStatus,
)
from graphon.model_runtime.utils.encoders import jsonable_encoder
from models.account import Account, Tenant
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom


def _create_account_with_tenant(session: Session) -> Account:
    tenant = Tenant(name="Test Workspace")
    session.add(tenant)
    session.flush()

    account = Account(name="test", email=f"test-{uuid4()}@example.com")
    session.add(account)
    session.flush()

    account._current_tenant = tenant
    return account


def _make_repo(session: Session, account: Account, app_id: str) -> SQLAlchemyWorkflowNodeExecutionRepository:
    engine = session.get_bind()
    assert isinstance(engine, Engine)
    return SQLAlchemyWorkflowNodeExecutionRepository(
        session_factory=sessionmaker(bind=engine, expire_on_commit=False),
        user=account,
        app_id=app_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
    )


def _create_node_execution_model(
    session: Session,
    *,
    tenant_id: str,
    app_id: str,
    workflow_id: str,
    workflow_run_id: str,
    index: int = 1,
    status: WorkflowNodeExecutionStatus = WorkflowNodeExecutionStatus.RUNNING,
) -> WorkflowNodeExecutionModel:
    model = WorkflowNodeExecutionModel(
        id=str(uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=workflow_id,
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        workflow_run_id=workflow_run_id,
        index=index,
        predecessor_node_id=None,
        node_execution_id=str(uuid4()),
        node_id=f"node-{index}",
        node_type=BuiltinNodeTypes.START,
        title=f"Test Node {index}",
        inputs='{"input_key": "input_value"}',
        process_data='{"process_key": "process_value"}',
        outputs='{"output_key": "output_value"}',
        status=status,
        error=None,
        elapsed_time=1.5,
        execution_metadata="{}",
        created_at=datetime.now(),
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        finished_at=None,
    )
    session.add(model)
    session.flush()
    return model


class TestSave:
    def test_save_new_record(self, db_session_with_containers: Session) -> None:
        account = _create_account_with_tenant(db_session_with_containers)
        app_id = str(uuid4())
        repo = _make_repo(db_session_with_containers, account, app_id)

        execution = WorkflowNodeExecution(
            id=str(uuid4()),
            workflow_id=str(uuid4()),
            node_execution_id=str(uuid4()),
            workflow_execution_id=str(uuid4()),
            index=1,
            predecessor_node_id=None,
            node_id="node-1",
            node_type=BuiltinNodeTypes.START,
            title="Test Node",
            inputs={"input_key": "input_value"},
            process_data={"process_key": "process_value"},
            outputs={"result": "success"},
            status=WorkflowNodeExecutionStatus.RUNNING,
            error=None,
            elapsed_time=1.5,
            metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 100},
            created_at=datetime.now(),
            finished_at=None,
        )

        repo.save(execution)

        engine = db_session_with_containers.get_bind()
        assert isinstance(engine, Engine)
        with sessionmaker(bind=engine, expire_on_commit=False)() as verify_session:
            saved = verify_session.get(WorkflowNodeExecutionModel, execution.id)
            assert saved is not None
            assert saved.tenant_id == account.current_tenant_id
            assert saved.app_id == app_id
            assert saved.node_id == "node-1"
            assert saved.status == WorkflowNodeExecutionStatus.RUNNING

    def test_save_updates_existing_record(self, db_session_with_containers: Session) -> None:
        account = _create_account_with_tenant(db_session_with_containers)
        repo = _make_repo(db_session_with_containers, account, str(uuid4()))

        execution = WorkflowNodeExecution(
            id=str(uuid4()),
            workflow_id=str(uuid4()),
            node_execution_id=str(uuid4()),
            workflow_execution_id=str(uuid4()),
            index=1,
            predecessor_node_id=None,
            node_id="node-1",
            node_type=BuiltinNodeTypes.START,
            title="Test Node",
            inputs=None,
            process_data=None,
            outputs=None,
            status=WorkflowNodeExecutionStatus.RUNNING,
            error=None,
            elapsed_time=0.0,
            metadata=None,
            created_at=datetime.now(),
            finished_at=None,
        )

        repo.save(execution)

        execution.status = WorkflowNodeExecutionStatus.SUCCEEDED
        execution.elapsed_time = 2.5
        repo.save(execution)

        engine = db_session_with_containers.get_bind()
        assert isinstance(engine, Engine)
        with sessionmaker(bind=engine, expire_on_commit=False)() as verify_session:
            saved = verify_session.get(WorkflowNodeExecutionModel, execution.id)
            assert saved is not None
            assert saved.status == WorkflowNodeExecutionStatus.SUCCEEDED
            assert saved.elapsed_time == 2.5


class TestGetByWorkflowExecution:
    def test_returns_executions_ordered(self, db_session_with_containers: Session) -> None:
        account = _create_account_with_tenant(db_session_with_containers)
        tenant_id = account.current_tenant_id
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        workflow_run_id = str(uuid4())
        repo = _make_repo(db_session_with_containers, account, app_id)

        _create_node_execution_model(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            index=1,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
        )
        _create_node_execution_model(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            index=2,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
        )
        db_session_with_containers.commit()

        order_config = OrderConfig(order_by=["index"], order_direction="desc")
        result = repo.get_by_workflow_execution(
            workflow_execution_id=workflow_run_id,
            order_config=order_config,
        )

        assert len(result) == 2
        assert result[0].index == 2
        assert result[1].index == 1
        assert all(isinstance(r, WorkflowNodeExecution) for r in result)

    def test_excludes_paused_executions(self, db_session_with_containers: Session) -> None:
        account = _create_account_with_tenant(db_session_with_containers)
        tenant_id = account.current_tenant_id
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        workflow_run_id = str(uuid4())
        repo = _make_repo(db_session_with_containers, account, app_id)

        _create_node_execution_model(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            index=1,
            status=WorkflowNodeExecutionStatus.RUNNING,
        )
        _create_node_execution_model(
            db_session_with_containers,
            tenant_id=tenant_id,
            app_id=app_id,
            workflow_id=workflow_id,
            workflow_run_id=workflow_run_id,
            index=2,
            status=WorkflowNodeExecutionStatus.PAUSED,
        )
        db_session_with_containers.commit()

        result = repo.get_by_workflow_execution(workflow_execution_id=workflow_run_id)

        assert len(result) == 1
        assert result[0].index == 1


class TestToDbModel:
    def test_converts_domain_to_db_model(self, db_session_with_containers: Session) -> None:
        account = _create_account_with_tenant(db_session_with_containers)
        app_id = str(uuid4())
        repo = _make_repo(db_session_with_containers, account, app_id)

        domain_model = WorkflowNodeExecution(
            id="test-id",
            workflow_id="test-workflow-id",
            node_execution_id="test-node-execution-id",
            workflow_execution_id="test-workflow-run-id",
            index=1,
            predecessor_node_id="test-predecessor-id",
            node_id="test-node-id",
            node_type=BuiltinNodeTypes.START,
            title="Test Node",
            inputs={"input_key": "input_value"},
            process_data={"process_key": "process_value"},
            outputs={"output_key": "output_value"},
            status=WorkflowNodeExecutionStatus.RUNNING,
            error=None,
            elapsed_time=1.5,
            metadata={
                WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 100,
                WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: Decimal("0.0"),
            },
            created_at=datetime.now(),
            finished_at=None,
        )

        db_model = repo._to_db_model(domain_model)

        assert isinstance(db_model, WorkflowNodeExecutionModel)
        assert db_model.id == domain_model.id
        assert db_model.tenant_id == account.current_tenant_id
        assert db_model.app_id == app_id
        assert db_model.workflow_id == domain_model.workflow_id
        assert db_model.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
        assert db_model.workflow_run_id == domain_model.workflow_execution_id
        assert db_model.index == domain_model.index
        assert db_model.predecessor_node_id == domain_model.predecessor_node_id
        assert db_model.node_execution_id == domain_model.node_execution_id
        assert db_model.node_id == domain_model.node_id
        assert db_model.node_type == domain_model.node_type
        assert db_model.title == domain_model.title
        assert db_model.inputs_dict == domain_model.inputs
        assert db_model.process_data_dict == domain_model.process_data
        assert db_model.outputs_dict == domain_model.outputs
        assert db_model.execution_metadata_dict == jsonable_encoder(domain_model.metadata)
        assert db_model.status == domain_model.status
        assert db_model.error == domain_model.error
        assert db_model.elapsed_time == domain_model.elapsed_time
        assert db_model.created_at == domain_model.created_at
        assert db_model.created_by_role == CreatorUserRole.ACCOUNT
        assert db_model.created_by == account.id
        assert db_model.finished_at == domain_model.finished_at


class TestToDomainModel:
    def test_converts_db_to_domain_model(self, db_session_with_containers: Session) -> None:
        account = _create_account_with_tenant(db_session_with_containers)
        app_id = str(uuid4())
        repo = _make_repo(db_session_with_containers, account, app_id)

        inputs_dict = {"input_key": "input_value"}
        process_data_dict = {"process_key": "process_value"}
        outputs_dict = {"output_key": "output_value"}
        metadata_dict = {str(WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS): 100}
        now = datetime.now()

        db_model = WorkflowNodeExecutionModel()
        db_model.id = "test-id"
        db_model.tenant_id = account.current_tenant_id
        db_model.app_id = app_id
        db_model.workflow_id = "test-workflow-id"
        db_model.triggered_from = "workflow-run"
        db_model.workflow_run_id = "test-workflow-run-id"
        db_model.index = 1
        db_model.predecessor_node_id = "test-predecessor-id"
        db_model.node_execution_id = "test-node-execution-id"
        db_model.node_id = "test-node-id"
        db_model.node_type = BuiltinNodeTypes.START
        db_model.title = "Test Node"
        db_model.inputs = json.dumps(inputs_dict)
        db_model.process_data = json.dumps(process_data_dict)
        db_model.outputs = json.dumps(outputs_dict)
        db_model.status = WorkflowNodeExecutionStatus.RUNNING
        db_model.error = None
        db_model.elapsed_time = 1.5
        db_model.execution_metadata = json.dumps(metadata_dict)
        db_model.created_at = now
        db_model.created_by_role = "account"
        db_model.created_by = account.id
        db_model.finished_at = None

        domain_model = repo._to_domain_model(db_model)

        assert isinstance(domain_model, WorkflowNodeExecution)
        assert domain_model.id == "test-id"
        assert domain_model.workflow_id == "test-workflow-id"
        assert domain_model.workflow_execution_id == "test-workflow-run-id"
        assert domain_model.index == 1
        assert domain_model.predecessor_node_id == "test-predecessor-id"
        assert domain_model.node_execution_id == "test-node-execution-id"
        assert domain_model.node_id == "test-node-id"
        assert domain_model.node_type == BuiltinNodeTypes.START
        assert domain_model.title == "Test Node"
        assert domain_model.inputs == inputs_dict
        assert domain_model.process_data == process_data_dict
        assert domain_model.outputs == outputs_dict
        assert domain_model.status == WorkflowNodeExecutionStatus.RUNNING
        assert domain_model.error is None
        assert domain_model.elapsed_time == 1.5
        assert domain_model.metadata == {WorkflowNodeExecutionMetadataKey(k): v for k, v in metadata_dict.items()}
        assert domain_model.created_at == now
        assert domain_model.finished_at is None

    def test_domain_model_without_offload_data(self, db_session_with_containers: Session) -> None:
        account = _create_account_with_tenant(db_session_with_containers)
        repo = _make_repo(db_session_with_containers, account, str(uuid4()))

        process_data = {"normal": "data"}
        db_model = WorkflowNodeExecutionModel()
        db_model.id = str(uuid4())
        db_model.tenant_id = account.current_tenant_id
        db_model.app_id = str(uuid4())
        db_model.workflow_id = str(uuid4())
        db_model.triggered_from = "workflow-run"
        db_model.workflow_run_id = None
        db_model.index = 1
        db_model.predecessor_node_id = None
        db_model.node_execution_id = str(uuid4())
        db_model.node_id = "test-node-id"
        db_model.node_type = "llm"
        db_model.title = "Test Node"
        db_model.inputs = None
        db_model.process_data = json.dumps(process_data)
        db_model.outputs = None
        db_model.status = "succeeded"
        db_model.error = None
        db_model.elapsed_time = 1.5
        db_model.execution_metadata = "{}"
        db_model.created_at = datetime.now()
        db_model.created_by_role = "account"
        db_model.created_by = account.id
        db_model.finished_at = None

        domain_model = repo._to_domain_model(db_model)

        assert domain_model.process_data == process_data
        assert domain_model.process_data_truncated is False
        assert domain_model.get_truncated_process_data() is None
