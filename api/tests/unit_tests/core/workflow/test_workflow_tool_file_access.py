from datetime import UTC, datetime
from functools import partial
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from context import capture_current_context
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from core.tools.workflow_as_tool.repository import WorkflowToolSource, WorkflowToolSourceRepository
from core.workflow.workflow_tool_container_handler import WorkflowToolContainerHandler
from core.workflow.workflow_tool_node import DifyWorkflowToolNode
from extensions.storage.storage_type import StorageType
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.nodes.protocols import ToolFileManagerProtocol
from graphon.runtime import RuntimeState, VariablePool
from models import ToolFile, UploadFile
from models.enums import CreatorUserRole
from tests.unit_tests.core.workflow.test_workflow_tool_container import _outer_graph, _workflow_tool_node
from tests.workflow_test_utils import build_test_run_context


@pytest.mark.parametrize("input_kind", ["system_files", "file", "file-list"])
@pytest.mark.parametrize(
    ("transfer_method", "permission"),
    [
        ("local_file", "owned"),
        ("local_file", "other-user"),
        ("local_file", "granted"),
        ("tool_file", "owned"),
        ("tool_file", "other-user"),
    ],
)
def test_workflow_tool_dispatcher_enforces_file_ownership(
    sqlite_session: Session, input_kind: str, transfer_method: str, permission: str
) -> None:
    owner_id = "user" if permission == "owned" else "other-user"
    stored_file: UploadFile | ToolFile
    if transfer_method == "local_file":
        stored_file = UploadFile(
            tenant_id="tenant",
            storage_type=StorageType.LOCAL,
            key="stored-file.txt",
            name="attachment.txt",
            size=12,
            extension="txt",
            mime_type="text/plain",
            created_by=owner_id,
            created_by_role=CreatorUserRole.ACCOUNT if permission == "granted" else CreatorUserRole.END_USER,
            created_at=datetime.now(UTC),
            used=False,
        )
    else:
        stored_file = ToolFile(
            tenant_id="tenant",
            user_id=owner_id,
            conversation_id=None,
            file_key="stored-file.txt",
            name="attachment.txt",
            mimetype="text/plain",
            size=12,
        )
    sqlite_session.add(stored_file)
    sqlite_session.commit()
    mapping = {"transfer_method": transfer_method, "type": "document", "related_id": stored_file.id}
    scope = FileAccessScope(
        tenant_id="tenant",
        user_id="user",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.SERVICE_API,
        granted_upload_file_ids=frozenset({stored_file.id}) if permission == "granted" else frozenset(),
    )
    with bind_file_access_scope(scope):
        runtime_state = RuntimeState(
            workflow_id="outer-workflow",
            variable_pool=VariablePool(),
            start_at=1,
            execution_context=capture_current_context(),
        )
    template_node, runtime, payload = _workflow_tool_node(runtime_state)
    node = DifyWorkflowToolNode(
        node_id=template_node.id,
        data=template_node.node_data,
        init_params=template_node.init_params.model_copy(
            update={
                "run_context": build_test_run_context(
                    app_id="outer-app", user_from=UserFrom.END_USER, invoke_from=InvokeFrom.SERVICE_API
                )
            }
        ),
        runtime_state=runtime_state,
        tool_file_manager=MagicMock(spec=ToolFileManagerProtocol),
        runtime=runtime,
    )
    variables: list[dict[str, object]] = []
    if input_kind == "system_files":
        payload = payload.model_copy(update={"system_files": [mapping], "inputs": {}})
        output_selector = ["sys", "files"]
    else:
        variables = [
            {
                "variable": "attachment",
                "label": "Attachment",
                "type": input_kind,
                "allowed_file_types": ["document"],
                "allowed_file_upload_methods": ["local_file"],
            }
        ]
        value = mapping if input_kind == "file" else [mapping]
        payload = payload.model_copy(update={"inputs": {"attachment": value}})
        output_selector = ["source-start", "attachment"]
    runtime.build_workflow_tool_container_payload.return_value = payload
    source = WorkflowToolSource(
        app_id="source-app",
        workflow_id="source-workflow",
        graph_config={
            "nodes": [
                {"id": "source-start", "data": {"type": "start", "title": "Start", "variables": variables}},
                {
                    "id": "source-end",
                    "data": {
                        "type": "end",
                        "title": "End",
                        "outputs": [{"variable": "accepted", "value_selector": output_selector}],
                    },
                },
            ],
            "edges": [{"id": "source-edge", "source": "source-start", "target": "source-end"}],
        },
        features_dict={},
        environment_variables=[],
        workflow_kind="standard",
    )
    repository = MagicMock(spec=WorkflowToolSourceRepository)
    repository.get_source.return_value = source
    engine = Engine(
        graph=_outer_graph(node),
        runtime_state=runtime_state,
        command_channel=InMemoryChannel(),
        workers=1,
        container_handler_factories=(partial(WorkflowToolContainerHandler, source_repository=repository),),
    )

    if permission == "other-user":
        expected_error = (
            "Invalid upload file" if transfer_method == "local_file" else f"ToolFile {stored_file.id} not found"
        )
        with pytest.raises(RuntimeError, match=expected_error):
            list(engine.run())
    else:
        events = list(engine.run())
        assert isinstance(events[-1], GraphRunSucceededEvent)
        tool_completed = next(
            event for event in events if isinstance(event, NodeRunSucceededEvent) and event.node_id == "tool"
        )
        accepted_files = tool_completed.node_run_result.outputs["files"]
        assert len(accepted_files) == 1
        assert accepted_files[0].filename == stored_file.name
