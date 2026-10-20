"""Prepare debug variables and persist node outputs through injected ports."""

import json
import logging
from collections.abc import Callable, Mapping, Sequence, Set
from functools import partial
from typing import Any, Protocol

from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.system_variables import SystemVariableKey
from core.workflow.variable_prefixes import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from graphon.nodes import BuiltinNodeTypes
from graphon.variable_loader import VariableLoader
from graphon.variables import Segment, StringSegment, VariableBase
from libs.uuid_utils import uuidv7
from machinery.context import RequestContext
from models import Account, App, Conversation, UploadFile, Workflow
from models.enums import ConversationFromSource, DraftVariableType, ExecutionOffLoadType
from models.workflow import (
    WorkflowDraftVariable,
    WorkflowNodeExecutionModel,
    is_system_variable_editable,
)
from services.workflow.draft_variable_service import (
    DraftFileRestorer,
    DraftFileUploader,
    DraftVariableReader,
    DraftVariableSaver,
    DraftVariableWriter,
    DraftVarLoader,
    UpdateNotSupportedError,
    VariableResetError,
    conversation_defaults,
)
from services.workflow.variable_contracts import WorkflowDraftVariableList

logger = logging.getLogger(__name__)


class DraftExecutionReader(Protocol):
    def get_execution_by_id(self, execution_id: str, tenant_id: str) -> WorkflowNodeExecutionModel | None:
        """Return a detached execution with offload records and upload files preloaded."""
        ...


class DraftVariableStorage(Protocol):
    def load(self, filename: str, /) -> bytes: ...
    def delete(self, filename: str) -> None: ...


class DebugVariableStore(DraftVariableReader, DraftVariableWriter, Protocol):
    def get_variable(self, variable_id: str, *, app_id: str, user_id: str) -> WorkflowDraftVariable | None: ...
    def list_variables_without_values(
        self, app_id: str, page: int, limit: int, user_id: str, *, exclude_node_ids: Set[str] | None
    ) -> WorkflowDraftVariableList: ...
    def list_node_variables(self, app_id: str, node_id: str, user_id: str) -> WorkflowDraftVariableList: ...
    def get_node_variable(self, app_id: str, node_id: str, name: str, user_id: str) -> WorkflowDraftVariable | None: ...
    def conversation_exists(self, app_id: str, conversation_id: str) -> bool: ...
    def add_conversation(self, conversation: Conversation) -> str: ...
    def update_variable(
        self, snapshot: WorkflowDraftVariable, *, name: str | None, value: Segment | None
    ) -> WorkflowDraftVariable: ...
    def delete_variables(self, app_id: str, *, user_id: str, node_id: str | None) -> list[str]: ...
    def prefill(self, variables: Sequence[WorkflowDraftVariable]) -> None: ...
    def actor(self, context: RequestContext, app_id: str) -> Account: ...
    def reset_variable(
        self, snapshot: WorkflowDraftVariable, value: Segment | None
    ) -> WorkflowDraftVariable | None: ...
    def delete_variable(self, snapshot: WorkflowDraftVariable) -> list[str]: ...
    def pending_file_cleanup(self, limit: int, *, after: str | None) -> list[str]: ...
    def get_orphan_uploads(self, upload_file_ids: Sequence[str]) -> list[UploadFile]: ...
    def delete_orphan_upload(self, upload_file_id: str) -> None: ...


class WorkflowVariableService:
    def __init__(
        self,
        *,
        repository: DebugVariableStore,
        files: DraftFileUploader,
        file_inputs: DraftFileRestorer,
        executions: DraftExecutionReader,
        storage: DraftVariableStorage,
        defer_file_cleanup: Callable[[list[str]], object],
    ) -> None:
        self._repository = repository
        self._files = files
        self._file_inputs = file_inputs
        self._executions = executions
        self._storage = storage
        self._defer_file_cleanup = defer_file_cleanup

    def get_variable(self, variable_id: str, *, app_id: str, user_id: str) -> WorkflowDraftVariable | None:
        return self._repository.get_variable(variable_id, app_id=app_id, user_id=user_id)

    def list_variables_without_values(
        self, app_id: str, page: int, limit: int, user_id: str, *, exclude_node_ids: Set[str] | None = None
    ) -> WorkflowDraftVariableList:
        return self._repository.list_variables_without_values(
            app_id, page, limit, user_id, exclude_node_ids=exclude_node_ids
        )

    def list_node_variables(self, app_id: str, node_id: str, user_id: str) -> WorkflowDraftVariableList:
        return self._repository.list_node_variables(app_id, node_id, user_id)

    def list_conversation_variables(self, app_id: str, user_id: str) -> WorkflowDraftVariableList:
        return self._repository.list_node_variables(app_id, CONVERSATION_VARIABLE_NODE_ID, user_id)

    def list_system_variables(self, app_id: str, user_id: str) -> WorkflowDraftVariableList:
        return self._repository.list_node_variables(app_id, SYSTEM_VARIABLE_NODE_ID, user_id)

    def update_variable(
        self, variable: WorkflowDraftVariable, name: str | None = None, value: Segment | None = None
    ) -> WorkflowDraftVariable:
        if not variable.editable:
            raise UpdateNotSupportedError(f"variable not support updating, id={variable.id}")
        updated = self._repository.update_variable(variable, name=name, value=value)
        if value is not None and variable.file_id is not None and variable.variable_file is not None:
            self._cleanup_or_defer([variable.variable_file.upload_file_id])
        return updated

    def delete_user_workflow_variables(self, app_id: str, user_id: str) -> None:
        self._cleanup_or_defer(self._repository.delete_variables(app_id, user_id=user_id, node_id=None))

    def delete_node_variables(self, app_id: str, node_id: str, user_id: str) -> None:
        self._cleanup_or_defer(self._repository.delete_variables(app_id, user_id=user_id, node_id=node_id))

    def _get_conversation_id_from_draft_variable(self, app_id: str, user_id: str) -> str | None:
        draft_var = self._repository.get_node_variable(
            app_id=app_id,
            node_id=SYSTEM_VARIABLE_NODE_ID,
            name=str(SystemVariableKey.CONVERSATION_ID),
            user_id=user_id,
        )
        if draft_var is None:
            return None
        segment = draft_var.get_value()
        if not isinstance(segment, StringSegment):
            logger.warning(
                "sys.conversation_id variable is not a string: app_id=%s, user_id=%s, id=%s",
                app_id,
                user_id,
                draft_var.id,
            )
            return None
        return segment.value

    def get_or_create_conversation(
        self,
        account_id: str,
        app: App,
        workflow: Workflow,
    ) -> str:
        """
        get_or_create_conversation creates and returns the ID of a conversation for debugging.

        If a conversation already exists, as determined by the following criteria, its ID is returned:
        - The system variable `sys.conversation_id` exists in the draft variable table, and
        - A corresponding conversation record is found in the database.

        If no such conversation exists, a new conversation is created and its ID is returned.
        """
        conv_id = self._get_conversation_id_from_draft_variable(workflow.app_id, account_id)

        if conv_id is not None:
            if self._repository.conversation_exists(workflow.app_id, conv_id):
                return conv_id
        conversation = Conversation(
            app_id=workflow.app_id,
            app_model_config_id=app.app_model_config_id,
            model_provider=None,
            model_id="",
            override_model_configs=None,
            mode=app.mode,
            name="Draft Debugging Conversation",
            inputs={},
            introduction="",
            system_instruction="",
            system_instruction_tokens=0,
            status="normal",
            invoke_from=InvokeFrom.DEBUGGER,
            from_source=ConversationFromSource.CONSOLE,
            from_end_user_id=None,
            from_account_id=account_id,
        )

        return self._repository.add_conversation(conversation)

    def prefill_conversation_variable_default_values(self, workflow: Workflow, user_id: str):
        self._repository.prefill(conversation_defaults(workflow.app_id, workflow.conversation_variables, user_id))

    def reset_variable(self, workflow: Workflow, variable: WorkflowDraftVariable) -> WorkflowDraftVariable | None:
        """Reset detached snapshots; storage reads occur between read and write transactions."""
        if variable.app_id != workflow.app_id:
            raise VariableResetError("Variable does not belong to the workflow")
        variable_type = variable.get_variable_type()
        if variable_type == DraftVariableType.SYS and not is_system_variable_editable(variable.name):
            raise VariableResetError(f"cannot reset system variable, variable_id={variable.id}")
        value: Segment | None
        if variable_type == DraftVariableType.CONVERSATION:
            value = next((item for item in workflow.conversation_variables if item.name == variable.name), None)
        elif not variable.editable:
            return variable
        else:
            outputs = self._execution_outputs(workflow, variable)
            if outputs is not None and variable_type == DraftVariableType.NODE:
                config = workflow.get_node_config_by_id(variable.node_id)
                if workflow.get_node_type_from_node_config(config) == BuiltinNodeTypes.VARIABLE_ASSIGNER:
                    return variable
            name = f"sys.{variable.name}" if variable_type == DraftVariableType.SYS else variable.name
            value_type = variable.value_type
            if variable.file_id is not None and variable.variable_file is not None:
                value_type = variable.variable_file.value_type
            value = (
                WorkflowDraftVariable.build_segment_with_type(value_type, outputs[name])
                if outputs is not None and name in outputs
                else None
            )
        result = self._repository.reset_variable(variable, value)
        if variable.file_id is not None and variable.variable_file is not None:
            self._cleanup_or_defer([variable.variable_file.upload_file_id])
        return result

    def _execution_outputs(self, workflow: Workflow, variable: WorkflowDraftVariable) -> Mapping[str, Any] | None:
        if variable.node_execution_id is None:
            return None
        execution = self._executions.get_execution_by_id(variable.node_execution_id, tenant_id=workflow.tenant_id)
        if execution is None or execution.app_id != workflow.app_id:
            return None
        return self.load_execution_outputs(execution)

    def load_execution_outputs(self, execution: WorkflowNodeExecutionModel) -> Mapping[str, Any] | None:
        """Read preloaded output metadata after the execution repository closes its session."""
        offload = next((item for item in execution.offload_data if item.type_ == ExecutionOffLoadType.OUTPUTS), None)
        if offload is None:
            return execution.outputs_dict
        if (
            offload.tenant_id != execution.tenant_id
            or offload.app_id != execution.app_id
            or offload.file is None
            or offload.file.tenant_id != execution.tenant_id
        ):
            raise VariableResetError(f"Execution output file not found, execution_id={execution.id}")
        return json.loads(self._storage.load(offload.file.key)) or {}

    def delete_variable(self, variable: WorkflowDraftVariable) -> None:
        self._cleanup_or_defer(self._repository.delete_variable(variable))

    def cleanup_files(self, upload_file_ids: Sequence[str]) -> None:
        """Reclaim owned uploads only after their variable references are gone.

        UploadFile retains the storage key even when variable metadata rolled back.
        Delete storage first so a failed cleanup remains retryable from that record.
        """
        for upload in self._repository.get_orphan_uploads(upload_file_ids):
            self._storage.delete(upload.key)
            self._repository.delete_orphan_upload(upload.id)

    def retry_file_cleanup(self, *, limit: int) -> None:
        """Visit each orphan once per sweep; a failed page never blocks later files."""
        after = None
        while upload_ids := self._repository.pending_file_cleanup(limit, after=after):
            for upload_id in upload_ids:
                try:
                    self.cleanup_files([upload_id])
                except Exception:
                    logger.exception("Draft upload cleanup remains pending, upload_file_id=%s", upload_id)
            after = upload_ids[-1]

    def _cleanup_or_defer(self, upload_file_ids: list[str]) -> None:
        if not upload_file_ids:
            return
        try:
            # Unreferenced file metadata survives both committed mutations and
            # failed saves, independently of Celery message delivery.
            self.cleanup_files(upload_file_ids)
        except Exception:
            logger.exception("Retrying draft file cleanup, upload_file_ids=%s", upload_file_ids)
            try:
                self._defer_file_cleanup(upload_file_ids)
            except Exception:
                logger.exception(
                    "Cleanup delivery failed; persisted requests await recovery, upload_file_ids=%s", upload_file_ids
                )

    def _loader(
        self, app_id: str, tenant_id: str, user_id: str, conversation_variables: Sequence[VariableBase]
    ) -> VariableLoader:
        self._repository.prefill(conversation_defaults(app_id, conversation_variables, user_id))
        return DraftVarLoader(
            self._repository,
            app_id,
            tenant_id,
            user_id,
            load_file=self._storage.load,
            file_inputs=self._file_inputs,
        )

    def workflow_loader(self, workflow: Workflow, user_id: str) -> VariableLoader:
        return self._loader(workflow.app_id, workflow.tenant_id, user_id, workflow.conversation_variables)

    def saver_factory(self, tenant_id: str, account: Account) -> DraftVariableSaverFactory:
        return partial(
            DraftVariableSaver,
            repository=self._repository,
            files=self._files,
            file_inputs=self._file_inputs,
            cleanup_files=self._cleanup_or_defer,
            tenant_id=tenant_id,
            user=account,
        )

    def loader(
        self, context: RequestContext, app_id: str, conversation_variables: Sequence[VariableBase]
    ) -> VariableLoader:
        account = self._repository.actor(context, app_id)
        return self._loader(app_id, context.active_workspace_id, account.id, conversation_variables)

    def save(
        self,
        context: RequestContext,
        app_id: str,
        node_id: str,
        enclosing_node_id: str | None,
        outputs: Mapping[str, Any],
    ) -> None:
        account = self._repository.actor(context, app_id)
        self.saver_factory(context.active_workspace_id, account)(
            app_id=app_id,
            node_id=node_id,
            node_type=BuiltinNodeTypes.HUMAN_INPUT,
            node_execution_id=str(uuidv7()),
            enclosing_node_id=enclosing_node_id,
        ).save(process_data=None, outputs=outputs)
