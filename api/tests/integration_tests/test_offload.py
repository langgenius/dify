import uuid

import pytest
from sqlalchemy.orm import Session, joinedload, selectinload

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models import db
from models.enums import CreatorUserRole
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload, WorkflowNodeExecutionTriggeredFrom


@pytest.fixture
def session(flask_req_ctx):
    with Session(bind=db.engine, expire_on_commit=False) as session:
        yield session


def test_offload(session, setup_account):
    tenant_id = str(uuid.uuid4())
    app_id = str(uuid.uuid4())
    # step 1: create a UploadFile
    input_upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type="local",
        key="fake_storage_key",
        name="test_file.txt",
        size=1024,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=setup_account.id,
        created_at=naive_utc_now(),
        used=False,
    )
    output_upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type="local",
        key="fake_storage_key",
        name="test_file.txt",
        size=1024,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=setup_account.id,
        created_at=naive_utc_now(),
        used=False,
    )
    session.add(input_upload_file)
    session.add(output_upload_file)
    session.flush()

    # step 2: create a WorkflowNodeExecutionModel
    node_execution = WorkflowNodeExecutionModel(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=str(uuid.uuid4()),
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        index=1,
        node_id="test_node_id",
        node_type="test",
        title="Test Node",
        status="succeeded",
        created_by_role=CreatorUserRole.ACCOUNT.value,
        created_by=setup_account.id,
    )
    session.add(node_execution)
    session.flush()

    # step 3: create a WorkflowNodeExecutionOffload
    offload = WorkflowNodeExecutionOffload(
        id=uuidv7(),
        tenant_id=tenant_id,
        app_id=app_id,
        node_execution_id=node_execution.id,
        inputs_file_id=input_upload_file.id,
        outputs_file_id=output_upload_file.id,
    )
    session.add(offload)
    session.flush()

    # Test preloading - this should work without raising LazyLoadError
    result = (
        session.query(WorkflowNodeExecutionModel)
        .options(
            selectinload(WorkflowNodeExecutionModel.offload_data).options(
                joinedload(
                    WorkflowNodeExecutionOffload.inputs_file,
                ),
                joinedload(
                    WorkflowNodeExecutionOffload.outputs_file,
                ),
            )
        )
        .filter(WorkflowNodeExecutionModel.id == node_execution.id)
        .first()
    )

    # Verify the relationships are properly loaded
    assert result is not None
    assert result.offload_data is not None
    assert result.offload_data.inputs_file is not None
    assert result.offload_data.inputs_file.id == input_upload_file.id
    assert result.offload_data.inputs_file.name == "test_file.txt"

    # Test the computed properties
    assert result.inputs_truncated is True
    assert result.outputs_truncated is False
    assert False


def _test_offload_save(session, setup_account):
    tenant_id = str(uuid.uuid4())
    app_id = str(uuid.uuid4())
    # step 1: create a UploadFile
    input_upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type="local",
        key="fake_storage_key",
        name="test_file.txt",
        size=1024,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=setup_account.id,
        created_at=naive_utc_now(),
        used=False,
    )
    output_upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type="local",
        key="fake_storage_key",
        name="test_file.txt",
        size=1024,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=setup_account.id,
        created_at=naive_utc_now(),
        used=False,
    )

    node_execution_id = id = str(uuid.uuid4())

    # step 3: create a WorkflowNodeExecutionOffload
    offload = WorkflowNodeExecutionOffload(
        id=uuidv7(),
        tenant_id=tenant_id,
        app_id=app_id,
        node_execution_id=node_execution_id,
    )
    offload.inputs_file = input_upload_file
    offload.outputs_file = output_upload_file

    # step 2: create a WorkflowNodeExecutionModel
    node_execution = WorkflowNodeExecutionModel(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_id=str(uuid.uuid4()),
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        index=1,
        node_id="test_node_id",
        node_type="test",
        title="Test Node",
        status="succeeded",
        created_by_role=CreatorUserRole.ACCOUNT.value,
        created_by=setup_account.id,
    )
    node_execution.offload_data = offload
    session.add(node_execution)
    session.flush()

    assert False


"""
2025-08-21 15:34:49,570 INFO sqlalchemy.engine.Engine BEGIN (implicit)
2025-08-21 15:34:49,572 INFO sqlalchemy.engine.Engine INSERT INTO upload_files (id, tenant_id, storage_type, key, name, size, extension, mime_type, created_by_role, created_by, created_at, used, used_by, used_at, hash, source_url) VALUES (%(id__0)s::UUID, %(tenant_id__0)s::UUID, %(storage_type__0)s, %(k ... 410 characters truncated ... (created_at__1)s, %(used__1)s, %(used_by__1)s::UUID, %(used_at__1)s, %(hash__1)s, %(source_url__1)s)
2025-08-21 15:34:49,572 INFO sqlalchemy.engine.Engine [generated in 0.00009s (insertmanyvalues) 1/1 (unordered)] {'created_at__0': datetime.datetime(2025, 8, 21, 15, 34, 49, 570482), 'id__0': '366621fa-4326-403e-8709-62e4d0de7367', 'storage_type__0': 'local', 'extension__0': 'txt', 'created_by__0': 'ccc7657c-fb48-46bd-8f42-c837b14eab18', 'used_at__0': None, 'used_by__0': None, 'source_url__0': '', 'mime_type__0': 'text/plain', 'created_by_role__0': 'account', 'used__0': False, 'size__0': 1024, 'tenant_id__0': '4c1bbfc9-a28b-4d93-8987-45db78e3269c', 'hash__0': None, 'key__0': 'fake_storage_key', 'name__0': 'test_file.txt', 'created_at__1': datetime.datetime(2025, 8, 21, 15, 34, 49, 570563), 'id__1': '3cdec641-a452-4df0-a9af-4a1a30c27ea5', 'storage_type__1': 'local', 'extension__1': 'txt', 'created_by__1': 'ccc7657c-fb48-46bd-8f42-c837b14eab18', 'used_at__1': None, 'used_by__1': None, 'source_url__1': '', 'mime_type__1': 'text/plain', 'created_by_role__1': 'account', 'used__1': False, 'size__1': 1024, 'tenant_id__1': '4c1bbfc9-a28b-4d93-8987-45db78e3269c', 'hash__1': None, 'key__1': 'fake_storage_key', 'name__1': 'test_file.txt'}
2025-08-21 15:34:49,576 INFO sqlalchemy.engine.Engine INSERT INTO workflow_node_executions (id, tenant_id, app_id, workflow_id, triggered_from, workflow_run_id, index, predecessor_node_id, node_execution_id, node_id, node_type, title, inputs, process_data, outputs, status, error, execution_metadata, created_by_role, created_by, finished_at) VALUES (%(id)s::UUID, %(tenant_id)s::UUID, %(app_id)s::UUID, %(workflow_id)s::UUID, %(triggered_from)s, %(workflow_run_id)s::UUID, %(index)s, %(predecessor_node_id)s, %(node_execution_id)s, %(node_id)s, %(node_type)s, %(title)s, %(inputs)s, %(process_data)s, %(outputs)s, %(status)s, %(error)s, %(execution_metadata)s, %(created_by_role)s, %(created_by)s::UUID, %(finished_at)s) RETURNING workflow_node_executions.elapsed_time, workflow_node_executions.created_at
2025-08-21 15:34:49,576 INFO sqlalchemy.engine.Engine [generated in 0.00019s] {'id': '9aac28b6-b6fc-4aea-abdf-21da3227e621', 'tenant_id': '4c1bbfc9-a28b-4d93-8987-45db78e3269c', 'app_id': '79fa81c7-2760-40db-af54-74cb2fea2ce7', 'workflow_id': '95d341e3-381c-4c54-a383-f685a9741053', 'triggered_from': <WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN: 'workflow-run'>, 'workflow_run_id': None, 'index': 1, 'predecessor_node_id': None, 'node_execution_id': None, 'node_id': 'test_node_id', 'node_type': 'test', 'title': 'Test Node', 'inputs': None, 'process_data': None, 'outputs': None, 'status': 'succeeded', 'error': None, 'execution_metadata': None, 'created_by_role': 'account', 'created_by': 'ccc7657c-fb48-46bd-8f42-c837b14eab18', 'finished_at': None}
2025-08-21 15:34:49,579 INFO sqlalchemy.engine.Engine INSERT INTO workflow_node_execution_offload (id, created_at, tenant_id, app_id, node_execution_id, inputs_file_id, outputs_file_id) VALUES (%(id)s::UUID, %(created_at)s, %(tenant_id)s::UUID, %(app_id)s::UUID, %(node_execution_id)s::UUID, %(inputs_file_id)s::UUID, %(outputs_file_id)s::UUID)
2025-08-21 15:34:49,579 INFO sqlalchemy.engine.Engine [generated in 0.00016s] {'id': '0198cd44-b7ea-724b-9e1b-5f062a2ef45b', 'created_at': datetime.datetime(2025, 8, 21, 15, 34, 49, 579072), 'tenant_id': '4c1bbfc9-a28b-4d93-8987-45db78e3269c', 'app_id': '79fa81c7-2760-40db-af54-74cb2fea2ce7', 'node_execution_id': '9aac28b6-b6fc-4aea-abdf-21da3227e621', 'inputs_file_id': '366621fa-4326-403e-8709-62e4d0de7367', 'outputs_file_id': '3cdec641-a452-4df0-a9af-4a1a30c27ea5'}
2025-08-21 15:34:49,581 INFO sqlalchemy.engine.Engine SELECT workflow_node_executions.id AS workflow_node_executions_id, workflow_node_executions.tenant_id AS workflow_node_executions_tenant_id, workflow_node_executions.app_id AS workflow_node_executions_app_id, workflow_node_executions.workflow_id AS workflow_node_executions_workflow_id, workflow_node_executions.triggered_from AS workflow_node_executions_triggered_from, workflow_node_executions.workflow_run_id AS workflow_node_executions_workflow_run_id, workflow_node_executions.index AS workflow_node_executions_index, workflow_node_executions.predecessor_node_id AS workflow_node_executions_predecessor_node_id, workflow_node_executions.node_execution_id AS workflow_node_executions_node_execution_id, workflow_node_executions.node_id AS workflow_node_executions_node_id, workflow_node_executions.node_type AS workflow_node_executions_node_type, workflow_node_executions.title AS workflow_node_executions_title, workflow_node_executions.inputs AS workflow_node_executions_inputs, workflow_node_executions.process_data AS workflow_node_executions_process_data, workflow_node_executions.outputs AS workflow_node_executions_outputs, workflow_node_executions.status AS workflow_node_executions_status, workflow_node_executions.error AS workflow_node_executions_error, workflow_node_executions.elapsed_time AS workflow_node_executions_elapsed_time, workflow_node_executions.execution_metadata AS workflow_node_executions_execution_metadata, workflow_node_executions.created_at AS workflow_node_executions_created_at, workflow_node_executions.created_by_role AS workflow_node_executions_created_by_role, workflow_node_executions.created_by AS workflow_node_executions_created_by, workflow_node_executions.finished_at AS workflow_node_executions_finished_at
FROM workflow_node_executions
WHERE workflow_node_executions.id = %(id_1)s::UUID
 LIMIT %(param_1)s
2025-08-21 15:34:49,581 INFO sqlalchemy.engine.Engine [generated in 0.00009s] {'id_1': '9aac28b6-b6fc-4aea-abdf-21da3227e621', 'param_1': 1}
2025-08-21 15:34:49,585 INFO sqlalchemy.engine.Engine SELECT workflow_node_execution_offload.node_execution_id AS workflow_node_execution_offload_node_execution_id, workflow_node_execution_offload.id AS workflow_node_execution_offload_id, workflow_node_execution_offload.created_at AS workflow_node_execution_offload_created_at, workflow_node_execution_offload.tenant_id AS workflow_node_execution_offload_tenant_id, workflow_node_execution_offload.app_id AS workflow_node_execution_offload_app_id, workflow_node_execution_offload.inputs_file_id AS workflow_node_execution_offload_inputs_file_id, workflow_node_execution_offload.outputs_file_id AS workflow_node_execution_offload_outputs_file_id
FROM workflow_node_execution_offload
WHERE workflow_node_execution_offload.node_execution_id IN (%(primary_keys_1)s::UUID)
2025-08-21 15:34:49,585 INFO sqlalchemy.engine.Engine [generated in 0.00021s] {'primary_keys_1': '9aac28b6-b6fc-4aea-abdf-21da3227e621'}
2025-08-21 15:34:49,587 INFO sqlalchemy.engine.Engine SELECT upload_files.id AS upload_files_id, upload_files.tenant_id AS upload_files_tenant_id, upload_files.storage_type AS upload_files_storage_type, upload_files.key AS upload_files_key, upload_files.name AS upload_files_name, upload_files.size AS upload_files_size, upload_files.extension AS upload_files_extension, upload_files.mime_type AS upload_files_mime_type, upload_files.created_by_role AS upload_files_created_by_role, upload_files.created_by AS upload_files_created_by, upload_files.created_at AS upload_files_created_at, upload_files.used AS upload_files_used, upload_files.used_by AS upload_files_used_by, upload_files.used_at AS upload_files_used_at, upload_files.hash AS upload_files_hash, upload_files.source_url AS upload_files_source_url
FROM upload_files
WHERE upload_files.id IN (%(primary_keys_1)s::UUID)
2025-08-21 15:34:49,587 INFO sqlalchemy.engine.Engine [generated in 0.00012s] {'primary_keys_1': '3cdec641-a452-4df0-a9af-4a1a30c27ea5'}
2025-08-21 15:34:49,588 INFO sqlalchemy.engine.Engine SELECT upload_files.id AS upload_files_id, upload_files.tenant_id AS upload_files_tenant_id, upload_files.storage_type AS upload_files_storage_type, upload_files.key AS upload_files_key, upload_files.name AS upload_files_name, upload_files.size AS upload_files_size, upload_files.extension AS upload_files_extension, upload_files.mime_type AS upload_files_mime_type, upload_files.created_by_role AS upload_files_created_by_role, upload_files.created_by AS upload_files_created_by, upload_files.created_at AS upload_files_created_at, upload_files.used AS upload_files_used, upload_files.used_by AS upload_files_used_by, upload_files.used_at AS upload_files_used_at, upload_files.hash AS upload_files_hash, upload_files.source_url AS upload_files_source_url
FROM upload_files
WHERE upload_files.id IN (%(primary_keys_1)s::UUID)
2025-08-21 15:34:49,588 INFO sqlalchemy.engine.Engine [generated in 0.00010s] {'primary_keys_1': '366621fa-4326-403e-8709-62e4d0de7367'}
"""


"""
upload_file_id: 366621fa-4326-403e-8709-62e4d0de7367 3cdec641-a452-4df0-a9af-4a1a30c27ea5

workflow_node_executions_id: 9aac28b6-b6fc-4aea-abdf-21da3227e621

offload_id: 0198cd44-b7ea-724b-9e1b-5f062a2ef45b
"""
