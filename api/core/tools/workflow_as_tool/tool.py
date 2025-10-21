import json
import logging
from collections.abc import Generator
from typing import Any

from flask import has_request_context
from sqlalchemy import select

from core.file import FILE_MODEL_IDENTITY, File, FileTransferMethod
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)
from core.tools.errors import ToolInvokeError
from extensions.ext_database import db
from factories.file_factory import build_from_mapping
from libs.login import current_user
from models import Account, Tenant
from models.model import App, EndUser
from models.workflow import Workflow

logger = logging.getLogger(__name__)


class WorkflowTool(Tool):
    """
    Workflow tool.
    """

    def __init__(
        self,
        workflow_app_id: str,
        workflow_as_tool_id: str,
        version: str,
        workflow_entities: dict[str, Any],
        workflow_call_depth: int,
        entity: ToolEntity,
        runtime: ToolRuntime,
        label: str = "Workflow",
    ):
        self.workflow_app_id = workflow_app_id
        self.workflow_as_tool_id = workflow_as_tool_id
        self.version = version
        self.workflow_entities = workflow_entities
        self.workflow_call_depth = workflow_call_depth
        self.label = label

        super().__init__(entity=entity, runtime=runtime)

    def tool_provider_type(self) -> ToolProviderType:
        """
        get the tool provider type

        :return: the tool provider type
        """
        return ToolProviderType.WORKFLOW

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        """
        invoke the tool
        """
        app = self._get_app(app_id=self.workflow_app_id)
        workflow = self._get_workflow(app_id=self.workflow_app_id, version=self.version)

        # transform the tool parameters
        tool_parameters, files = self._transform_args(tool_parameters=tool_parameters)

        from core.app.apps.workflow.app_generator import WorkflowAppGenerator

        generator = WorkflowAppGenerator()
        assert self.runtime is not None
        assert self.runtime.invoke_from is not None

        user = self._resolve_user(user_id=user_id)

        if user is None:
            raise ToolInvokeError("User not found")

        result = generator.generate(
            app_model=app,
            workflow=workflow,
            user=user,
            args={"inputs": tool_parameters, "files": files},
            invoke_from=self.runtime.invoke_from,
            streaming=False,
            call_depth=self.workflow_call_depth + 1,
        )
        assert isinstance(result, dict)
        data = result.get("data", {})

        if err := data.get("error"):
            raise ToolInvokeError(err)

        outputs = data.get("outputs")
        if outputs is None:
            outputs = {}
        else:
            outputs, files = self._extract_files(outputs)  # type: ignore
            for file in files:
                yield self.create_file_message(file)  # type: ignore

        yield self.create_text_message(json.dumps(outputs, ensure_ascii=False))
        yield self.create_json_message(outputs)

    def fork_tool_runtime(self, runtime: ToolRuntime) -> "WorkflowTool":
        """
        fork a new tool with metadata

        :return: the new tool
        """
        return self.__class__(
            entity=self.entity.model_copy(),
            runtime=runtime,
            workflow_app_id=self.workflow_app_id,
            workflow_as_tool_id=self.workflow_as_tool_id,
            workflow_entities=self.workflow_entities,
            workflow_call_depth=self.workflow_call_depth,
            version=self.version,
            label=self.label,
        )

    def _resolve_user(self, user_id: str) -> Account | EndUser | None:
        """
        Resolve user object in both HTTP and worker contexts.

        In HTTP context: dereference the current_user LocalProxy (can return Account or EndUser).
        In worker context: load Account from database by user_id (only returns Account, never EndUser).

        Returns:
            Account | EndUser | None: The resolved user object, or None if resolution fails.
        """
        if has_request_context():
            return self._resolve_user_from_request()
        else:
            return self._resolve_user_from_database(user_id=user_id)

    def _resolve_user_from_request(self) -> Account | EndUser | None:
        """
        Resolve user from Flask request context.
        """
        try:
            # Note: `current_user` is a LocalProxy. Never compare it with None directly.
            return getattr(current_user, "_get_current_object", lambda: current_user)()
        except Exception as e:
            logger.warning("Failed to resolve user from request context: %s", e)
            return None

    def _resolve_user_from_database(self, user_id: str) -> Account | None:
        """
        Resolve user from database (worker/Celery context).
        """

        user_stmt = select(Account).where(Account.id == user_id)
        user = db.session.scalar(user_stmt)
        if not user:
            return None

        tenant_stmt = select(Tenant).where(Tenant.id == self.runtime.tenant_id)
        tenant = db.session.scalar(tenant_stmt)
        if not tenant:
            return None

        user.current_tenant = tenant

        return user

    def _get_workflow(self, app_id: str, version: str) -> Workflow:
        """
        get the workflow by app id and version
        """
        if not version:
            workflow = (
                db.session.query(Workflow)
                .where(Workflow.app_id == app_id, Workflow.version != Workflow.VERSION_DRAFT)
                .order_by(Workflow.created_at.desc())
                .first()
            )
        else:
            stmt = select(Workflow).where(Workflow.app_id == app_id, Workflow.version == version)
            workflow = db.session.scalar(stmt)

        if not workflow:
            raise ValueError("workflow not found or not published")

        return workflow

    def _get_app(self, app_id: str) -> App:
        """
        get the app by app id
        """
        stmt = select(App).where(App.id == app_id)
        app = db.session.scalar(stmt)
        if not app:
            raise ValueError("app not found")

        return app

    def _transform_args(self, tool_parameters: dict) -> tuple[dict, list[dict]]:
        """
        transform the tool parameters

        :param tool_parameters: the tool parameters
        :return: tool_parameters, files
        """
        parameter_rules = self.get_merged_runtime_parameters()
        parameters_result = {}
        files = []
        for parameter in parameter_rules:
            if parameter.type == ToolParameter.ToolParameterType.SYSTEM_FILES:
                file = tool_parameters.get(parameter.name)
                if file:
                    try:
                        file_var_list = [File.model_validate(f) for f in file]
                        for file in file_var_list:
                            file_dict: dict[str, str | None] = {
                                "transfer_method": file.transfer_method.value,
                                "type": file.type.value,
                            }
                            if file.transfer_method == FileTransferMethod.TOOL_FILE:
                                file_dict["tool_file_id"] = file.related_id
                            elif file.transfer_method == FileTransferMethod.LOCAL_FILE:
                                file_dict["upload_file_id"] = file.related_id
                            elif file.transfer_method == FileTransferMethod.REMOTE_URL:
                                file_dict["url"] = file.generate_url()

                            files.append(file_dict)
                    except Exception:
                        logger.exception("Failed to transform file %s", file)
            else:
                parameters_result[parameter.name] = tool_parameters.get(parameter.name)

        return parameters_result, files

    def _extract_files(self, outputs: dict) -> tuple[dict, list[File]]:
        """
        extract files from the result

        :return: the result, files
        """
        files: list[File] = []
        result = {}
        for key, value in outputs.items():
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, dict) and item.get("dify_model_identity") == FILE_MODEL_IDENTITY:
                        item = self._update_file_mapping(item)
                        file = build_from_mapping(
                            mapping=item,
                            tenant_id=str(self.runtime.tenant_id),
                        )
                        files.append(file)
            elif isinstance(value, dict) and value.get("dify_model_identity") == FILE_MODEL_IDENTITY:
                value = self._update_file_mapping(value)
                file = build_from_mapping(
                    mapping=value,
                    tenant_id=str(self.runtime.tenant_id),
                )
                files.append(file)

            result[key] = value

        return result, files

    def _update_file_mapping(self, file_dict: dict):
        transfer_method = FileTransferMethod.value_of(file_dict.get("transfer_method"))
        if transfer_method == FileTransferMethod.TOOL_FILE:
            file_dict["tool_file_id"] = file_dict.get("related_id")
        elif transfer_method == FileTransferMethod.LOCAL_FILE:
            file_dict["upload_file_id"] = file_dict.get("related_id")
        return file_dict
