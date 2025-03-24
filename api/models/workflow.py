import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, Optional, Self, Union
from uuid import uuid4

if TYPE_CHECKING:
    from models.model import AppMode
from enum import StrEnum
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy import Index, PrimaryKeyConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

import contexts
from constants import HIDDEN_VALUE
from core.helper import encrypter
from core.variables import SecretVariable, Variable
from factories import variable_factory
from libs import helper
from models.base import Base
from models.enums import CreatedByRole

from .account import Account
from .engine import db
from .types import StringUUID

if TYPE_CHECKING:
    from models.model import AppMode


class WorkflowType(Enum):
    """
    Workflow Type Enum
    """

    WORKFLOW = "workflow"
    CHAT = "chat"

    @classmethod
    def value_of(cls, value: str) -> "WorkflowType":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid workflow type value {value}")

    @classmethod
    def from_app_mode(cls, app_mode: Union[str, "AppMode"]) -> "WorkflowType":
        """
        Get workflow type from app mode.

        :param app_mode: app mode
        :return: workflow type
        """
        from models.model import AppMode

        app_mode = app_mode if isinstance(app_mode, AppMode) else AppMode.value_of(app_mode)
        return cls.WORKFLOW if app_mode == AppMode.WORKFLOW else cls.CHAT


class Workflow(Base):
    """
    Workflow, for `Workflow App` and `Chat App workflow mode`.

    Attributes:

    - id (uuid) Workflow ID, pk
    - tenant_id (uuid) Workspace ID
    - app_id (uuid) App ID
    - type (string) Workflow type

        `workflow` for `Workflow App`

        `chat` for `Chat App workflow mode`

    - version (string) Version

        `draft` for draft version (only one for each app), other for version number (redundant)

    - graph (text) Workflow canvas configuration (JSON)

        The entire canvas configuration JSON, including Node, Edge, and other configurations

        - nodes (array[object]) Node list, see Node Schema

        - edges (array[object]) Edge list, see Edge Schema

    - created_by (uuid) Creator ID
    - created_at (timestamp) Creation time
    - updated_by (uuid) `optional` Last updater ID
    - updated_at (timestamp) `optional` Last update time
    """

    __tablename__ = "workflows"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="workflow_pkey"),
        db.Index("workflow_version_idx", "tenant_id", "app_id", "version"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    type: Mapped[str] = mapped_column(db.String(255), nullable=False)
    version: Mapped[str]
    marked_name: Mapped[str] = mapped_column(default="", server_default="")
    marked_comment: Mapped[str] = mapped_column(default="", server_default="")
    graph: Mapped[str] = mapped_column(sa.Text)
    _features: Mapped[str] = mapped_column("features", sa.TEXT)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by: Mapped[Optional[str]] = mapped_column(StringUUID)
    updated_at: Mapped[datetime] = mapped_column(
        db.DateTime,
        nullable=False,
        default=datetime.now(UTC).replace(tzinfo=None),
        server_onupdate=func.current_timestamp(),
    )
    _environment_variables: Mapped[str] = mapped_column(
        "environment_variables", db.Text, nullable=False, server_default="{}"
    )
    _conversation_variables: Mapped[str] = mapped_column(
        "conversation_variables", db.Text, nullable=False, server_default="{}"
    )

    @classmethod
    def new(
        cls,
        *,
        tenant_id: str,
        app_id: str,
        type: str,
        version: str,
        graph: str,
        features: str,
        created_by: str,
        environment_variables: Sequence[Variable],
        conversation_variables: Sequence[Variable],
        marked_name: str = "",
        marked_comment: str = "",
    ) -> Self:
        workflow = Workflow()
        workflow.id = str(uuid4())
        workflow.tenant_id = tenant_id
        workflow.app_id = app_id
        workflow.type = type
        workflow.version = version
        workflow.graph = graph
        workflow.features = features
        workflow.created_by = created_by
        workflow.environment_variables = environment_variables or []
        workflow.conversation_variables = conversation_variables or []
        workflow.marked_name = marked_name
        workflow.marked_comment = marked_comment
        workflow.created_at = datetime.now(UTC).replace(tzinfo=None)
        workflow.updated_at = workflow.created_at
        return workflow

    @property
    def created_by_account(self):
        return db.session.get(Account, self.created_by)

    @property
    def updated_by_account(self):
        return db.session.get(Account, self.updated_by) if self.updated_by else None

    @property
    def graph_dict(self) -> Mapping[str, Any]:
        return json.loads(self.graph) if self.graph else {}

    @property
    def features(self) -> str:
        """
        Convert old features structure to new features structure.
        """
        if not self._features:
            return self._features

        features = json.loads(self._features)
        if features.get("file_upload", {}).get("image", {}).get("enabled", False):
            image_enabled = True
            image_number_limits = int(features["file_upload"]["image"].get("number_limits", 1))
            image_transfer_methods = features["file_upload"]["image"].get(
                "transfer_methods", ["remote_url", "local_file"]
            )
            features["file_upload"]["enabled"] = image_enabled
            features["file_upload"]["number_limits"] = image_number_limits
            features["file_upload"]["allowed_file_upload_methods"] = image_transfer_methods
            features["file_upload"]["allowed_file_types"] = features["file_upload"].get("allowed_file_types", ["image"])
            features["file_upload"]["allowed_file_extensions"] = []
            del features["file_upload"]["image"]
            self._features = json.dumps(features)
        return self._features

    @features.setter
    def features(self, value: str) -> None:
        self._features = value

    @property
    def features_dict(self) -> dict[str, Any]:
        return json.loads(self.features) if self.features else {}

    def user_input_form(self, to_old_structure: bool = False) -> list:
        # get start node from graph
        if not self.graph:
            return []

        graph_dict = self.graph_dict
        if "nodes" not in graph_dict:
            return []

        start_node = next((node for node in graph_dict["nodes"] if node["data"]["type"] == "start"), None)
        if not start_node:
            return []

        # get user_input_form from start node
        variables: list[Any] = start_node.get("data", {}).get("variables", [])

        if to_old_structure:
            old_structure_variables = []
            for variable in variables:
                old_structure_variables.append({variable["type"]: variable})

            return old_structure_variables

        return variables

    @property
    def unique_hash(self) -> str:
        """
        Get hash of workflow.

        :return: hash
        """
        entity = {"graph": self.graph_dict, "features": self.features_dict}

        return helper.generate_text_hash(json.dumps(entity, sort_keys=True))

    @property
    def tool_published(self) -> bool:
        from models.tools import WorkflowToolProvider

        return (
            db.session.query(WorkflowToolProvider)
            .filter(WorkflowToolProvider.tenant_id == self.tenant_id, WorkflowToolProvider.app_id == self.app_id)
            .count()
            > 0
        )

    @property
    def environment_variables(self) -> Sequence[Variable]:
        # TODO: find some way to init `self._environment_variables` when instance created.
        if self._environment_variables is None:
            self._environment_variables = "{}"

        tenant_id = contexts.tenant_id.get()

        environment_variables_dict: dict[str, Any] = json.loads(self._environment_variables)
        results = [
            variable_factory.build_environment_variable_from_mapping(v) for v in environment_variables_dict.values()
        ]

        # decrypt secret variables value
        def decrypt_func(var):
            if isinstance(var, SecretVariable):
                return var.model_copy(update={"value": encrypter.decrypt_token(tenant_id=tenant_id, token=var.value)})
            else:
                return var

        results = list(map(decrypt_func, results))
        return results

    @environment_variables.setter
    def environment_variables(self, value: Sequence[Variable]):
        if not value:
            self._environment_variables = "{}"
            return

        tenant_id = contexts.tenant_id.get()

        value = list(value)
        if any(var for var in value if not var.id):
            raise ValueError("environment variable require a unique id")

        # Compare inputs and origin variables,
        # if the value is HIDDEN_VALUE, use the origin variable value (only update `name`).
        origin_variables_dictionary = {var.id: var for var in self.environment_variables}
        for i, variable in enumerate(value):
            if variable.id in origin_variables_dictionary and variable.value == HIDDEN_VALUE:
                value[i] = origin_variables_dictionary[variable.id].model_copy(update={"name": variable.name})

        # encrypt secret variables value
        def encrypt_func(var):
            if isinstance(var, SecretVariable):
                return var.model_copy(update={"value": encrypter.encrypt_token(tenant_id=tenant_id, token=var.value)})
            else:
                return var

        encrypted_vars = list(map(encrypt_func, value))
        environment_variables_json = json.dumps(
            {var.name: var.model_dump() for var in encrypted_vars},
            ensure_ascii=False,
        )
        self._environment_variables = environment_variables_json

    def to_dict(self, *, include_secret: bool = False) -> Mapping[str, Any]:
        environment_variables = list(self.environment_variables)
        environment_variables = [
            v if not isinstance(v, SecretVariable) or include_secret else v.model_copy(update={"value": ""})
            for v in environment_variables
        ]

        result = {
            "graph": self.graph_dict,
            "features": self.features_dict,
            "environment_variables": [var.model_dump(mode="json") for var in environment_variables],
            "conversation_variables": [var.model_dump(mode="json") for var in self.conversation_variables],
        }
        return result

    @property
    def conversation_variables(self) -> Sequence[Variable]:
        # TODO: find some way to init `self._conversation_variables` when instance created.
        if self._conversation_variables is None:
            self._conversation_variables = "{}"

        variables_dict: dict[str, Any] = json.loads(self._conversation_variables)
        results = [variable_factory.build_conversation_variable_from_mapping(v) for v in variables_dict.values()]
        return results

    @conversation_variables.setter
    def conversation_variables(self, value: Sequence[Variable]) -> None:
        self._conversation_variables = json.dumps(
            {var.name: var.model_dump() for var in value},
            ensure_ascii=False,
        )


class WorkflowRunStatus(StrEnum):
    """
    Workflow Run Status Enum
    """

    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    STOPPED = "stopped"
    PARTIAL_SUCCESSED = "partial-succeeded"


class WorkflowRun(Base):
    """
    Workflow Run

    Attributes:

    - id (uuid) Run ID
    - tenant_id (uuid) Workspace ID
    - app_id (uuid) App ID
    - sequence_number (int) Auto-increment sequence number, incremented within the App, starting from 1
    - workflow_id (uuid) Workflow ID
    - type (string) Workflow type
    - triggered_from (string) Trigger source

        `debugging` for canvas debugging

        `app-run` for (published) app execution

    - version (string) Version
    - graph (text) Workflow canvas configuration (JSON)
    - inputs (text) Input parameters
    - status (string) Execution status, `running` / `succeeded` / `failed` / `stopped`
    - outputs (text) `optional` Output content
    - error (string) `optional` Error reason
    - elapsed_time (float) `optional` Time consumption (s)
    - total_tokens (int) `optional` Total tokens used
    - total_steps (int) Total steps (redundant), default 0
    - created_by_role (string) Creator role

        - `account` Console account

        - `end_user` End user

    - created_by (uuid) Runner ID
    - created_at (timestamp) Run time
    - finished_at (timestamp) End time
    """

    __tablename__ = "workflow_runs"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="workflow_run_pkey"),
        db.Index("workflow_run_triggerd_from_idx", "tenant_id", "app_id", "triggered_from"),
        db.Index("workflow_run_tenant_app_sequence_idx", "tenant_id", "app_id", "sequence_number"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    app_id: Mapped[str] = mapped_column(StringUUID)
    sequence_number: Mapped[int] = mapped_column()
    workflow_id: Mapped[str] = mapped_column(StringUUID)
    type: Mapped[str] = mapped_column(db.String(255))
    triggered_from: Mapped[str] = mapped_column(db.String(255))
    version: Mapped[str] = mapped_column(db.String(255))
    graph: Mapped[Optional[str]] = mapped_column(db.Text)
    inputs: Mapped[Optional[str]] = mapped_column(db.Text)
    status: Mapped[str] = mapped_column(db.String(255))  # running, succeeded, failed, stopped, partial-succeeded
    outputs: Mapped[Optional[str]] = mapped_column(sa.Text, default="{}")
    error: Mapped[Optional[str]] = mapped_column(db.Text)
    elapsed_time = db.Column(db.Float, nullable=False, server_default=sa.text("0"))
    total_tokens: Mapped[int] = mapped_column(sa.BigInteger, server_default=sa.text("0"))
    total_steps = db.Column(db.Integer, server_default=db.text("0"))
    created_by_role: Mapped[str] = mapped_column(db.String(255))  # account, end_user
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    finished_at = db.Column(db.DateTime)
    exceptions_count = db.Column(db.Integer, server_default=db.text("0"))

    @property
    def created_by_account(self):
        created_by_role = CreatedByRole(self.created_by_role)
        return db.session.get(Account, self.created_by) if created_by_role == CreatedByRole.ACCOUNT else None

    @property
    def created_by_end_user(self):
        from models.model import EndUser

        created_by_role = CreatedByRole(self.created_by_role)
        return db.session.get(EndUser, self.created_by) if created_by_role == CreatedByRole.END_USER else None

    @property
    def graph_dict(self):
        return json.loads(self.graph) if self.graph else {}

    @property
    def inputs_dict(self) -> Mapping[str, Any]:
        return json.loads(self.inputs) if self.inputs else {}

    @property
    def outputs_dict(self) -> Mapping[str, Any]:
        return json.loads(self.outputs) if self.outputs else {}

    @property
    def message(self):
        from models.model import Message

        return (
            db.session.query(Message).filter(Message.app_id == self.app_id, Message.workflow_run_id == self.id).first()
        )

    @property
    def workflow(self):
        return db.session.query(Workflow).filter(Workflow.id == self.workflow_id).first()

    def to_dict(self):
        return {
            "id": self.id,
            "tenant_id": self.tenant_id,
            "app_id": self.app_id,
            "sequence_number": self.sequence_number,
            "workflow_id": self.workflow_id,
            "type": self.type,
            "triggered_from": self.triggered_from,
            "version": self.version,
            "graph": self.graph_dict,
            "inputs": self.inputs_dict,
            "status": self.status,
            "outputs": self.outputs_dict,
            "error": self.error,
            "elapsed_time": self.elapsed_time,
            "total_tokens": self.total_tokens,
            "total_steps": self.total_steps,
            "created_by_role": self.created_by_role,
            "created_by": self.created_by,
            "created_at": self.created_at,
            "finished_at": self.finished_at,
            "exceptions_count": self.exceptions_count,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "WorkflowRun":
        return cls(
            id=data.get("id"),
            tenant_id=data.get("tenant_id"),
            app_id=data.get("app_id"),
            sequence_number=data.get("sequence_number"),
            workflow_id=data.get("workflow_id"),
            type=data.get("type"),
            triggered_from=data.get("triggered_from"),
            version=data.get("version"),
            graph=json.dumps(data.get("graph")),
            inputs=json.dumps(data.get("inputs")),
            status=data.get("status"),
            outputs=json.dumps(data.get("outputs")),
            error=data.get("error"),
            elapsed_time=data.get("elapsed_time"),
            total_tokens=data.get("total_tokens"),
            total_steps=data.get("total_steps"),
            created_by_role=data.get("created_by_role"),
            created_by=data.get("created_by"),
            created_at=data.get("created_at"),
            finished_at=data.get("finished_at"),
            exceptions_count=data.get("exceptions_count"),
        )


class WorkflowNodeExecutionTriggeredFrom(Enum):
    """
    Workflow Node Execution Triggered From Enum
    """

    SINGLE_STEP = "single-step"
    WORKFLOW_RUN = "workflow-run"

    @classmethod
    def value_of(cls, value: str) -> "WorkflowNodeExecutionTriggeredFrom":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid workflow node execution triggered from value {value}")


class WorkflowNodeExecutionStatus(Enum):
    """
    Workflow Node Execution Status Enum
    """

    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    EXCEPTION = "exception"
    RETRY = "retry"

    @classmethod
    def value_of(cls, value: str) -> "WorkflowNodeExecutionStatus":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid workflow node execution status value {value}")


class WorkflowNodeExecution(Base):
    """
    Workflow Node Execution

    - id (uuid) Execution ID
    - tenant_id (uuid) Workspace ID
    - app_id (uuid) App ID
    - workflow_id (uuid) Workflow ID
    - triggered_from (string) Trigger source

        `single-step` for single-step debugging

        `workflow-run` for workflow execution (debugging / user execution)

    - workflow_run_id (uuid) `optional` Workflow run ID

        Null for single-step debugging.

    - index (int) Execution sequence number, used for displaying Tracing Node order
    - predecessor_node_id (string) `optional` Predecessor node ID, used for displaying execution path
    - node_id (string) Node ID
    - node_type (string) Node type, such as `start`
    - title (string) Node title
    - inputs (json) All predecessor node variable content used in the node
    - process_data (json) Node process data
    - outputs (json) `optional` Node output variables
    - status (string) Execution status, `running` / `succeeded` / `failed`
    - error (string) `optional` Error reason
    - elapsed_time (float) `optional` Time consumption (s)
    - execution_metadata (text) Metadata

        - total_tokens (int) `optional` Total tokens used

        - total_price (decimal) `optional` Total cost

        - currency (string) `optional` Currency, such as USD / RMB

    - created_at (timestamp) Run time
    - created_by_role (string) Creator role

        - `account` Console account

        - `end_user` End user

    - created_by (uuid) Runner ID
    - finished_at (timestamp) End time
    """

    __tablename__ = "workflow_node_executions"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="workflow_node_execution_pkey"),
        db.Index(
            "workflow_node_execution_workflow_run_idx",
            "tenant_id",
            "app_id",
            "workflow_id",
            "triggered_from",
            "workflow_run_id",
        ),
        db.Index(
            "workflow_node_execution_node_run_idx", "tenant_id", "app_id", "workflow_id", "triggered_from", "node_id"
        ),
        db.Index(
            "workflow_node_execution_id_idx",
            "tenant_id",
            "app_id",
            "workflow_id",
            "triggered_from",
            "node_execution_id",
        ),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    app_id: Mapped[str] = mapped_column(StringUUID)
    workflow_id: Mapped[str] = mapped_column(StringUUID)
    triggered_from: Mapped[str] = mapped_column(db.String(255))
    workflow_run_id: Mapped[Optional[str]] = mapped_column(StringUUID)
    index: Mapped[int] = mapped_column(db.Integer)
    predecessor_node_id: Mapped[Optional[str]] = mapped_column(db.String(255))
    node_execution_id: Mapped[Optional[str]] = mapped_column(db.String(255))
    node_id: Mapped[str] = mapped_column(db.String(255))
    node_type: Mapped[str] = mapped_column(db.String(255))
    title: Mapped[str] = mapped_column(db.String(255))
    inputs: Mapped[Optional[str]] = mapped_column(db.Text)
    process_data: Mapped[Optional[str]] = mapped_column(db.Text)
    outputs: Mapped[Optional[str]] = mapped_column(db.Text)
    status: Mapped[str] = mapped_column(db.String(255))
    error: Mapped[Optional[str]] = mapped_column(db.Text)
    elapsed_time: Mapped[float] = mapped_column(db.Float, server_default=db.text("0"))
    execution_metadata: Mapped[Optional[str]] = mapped_column(db.Text)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, server_default=func.current_timestamp())
    created_by_role: Mapped[str] = mapped_column(db.String(255))
    created_by: Mapped[str] = mapped_column(StringUUID)
    finished_at: Mapped[Optional[datetime]] = mapped_column(db.DateTime)

    @property
    def created_by_account(self):
        created_by_role = CreatedByRole(self.created_by_role)
        return db.session.get(Account, self.created_by) if created_by_role == CreatedByRole.ACCOUNT else None

    @property
    def created_by_end_user(self):
        from models.model import EndUser

        created_by_role = CreatedByRole(self.created_by_role)
        return db.session.get(EndUser, self.created_by) if created_by_role == CreatedByRole.END_USER else None

    @property
    def inputs_dict(self):
        return json.loads(self.inputs) if self.inputs else None

    @property
    def outputs_dict(self):
        return json.loads(self.outputs) if self.outputs else None

    @property
    def process_data_dict(self):
        return json.loads(self.process_data) if self.process_data else None

    @property
    def execution_metadata_dict(self):
        return json.loads(self.execution_metadata) if self.execution_metadata else None

    @property
    def extras(self):
        from core.tools.tool_manager import ToolManager

        extras = {}
        if self.execution_metadata_dict:
            from core.workflow.nodes import NodeType

            if self.node_type == NodeType.TOOL.value and "tool_info" in self.execution_metadata_dict:
                tool_info = self.execution_metadata_dict["tool_info"]
                extras["icon"] = ToolManager.get_tool_icon(
                    tenant_id=self.tenant_id,
                    provider_type=tool_info["provider_type"],
                    provider_id=tool_info["provider_id"],
                )

        return extras


class WorkflowAppLogCreatedFrom(Enum):
    """
    Workflow App Log Created From Enum
    """

    SERVICE_API = "service-api"
    WEB_APP = "web-app"
    INSTALLED_APP = "installed-app"

    @classmethod
    def value_of(cls, value: str) -> "WorkflowAppLogCreatedFrom":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid workflow app log created from value {value}")


class WorkflowAppLog(Base):
    """
    Workflow App execution log, excluding workflow debugging records.

    Attributes:

    - id (uuid) run ID
    - tenant_id (uuid) Workspace ID
    - app_id (uuid) App ID
    - workflow_id (uuid) Associated Workflow ID
    - workflow_run_id (uuid) Associated Workflow Run ID
    - created_from (string) Creation source

        `service-api` App Execution OpenAPI

        `web-app` WebApp

        `installed-app` Installed App

    - created_by_role (string) Creator role

        - `account` Console account

        - `end_user` End user

    - created_by (uuid) Creator ID, depends on the user table according to created_by_role
    - created_at (timestamp) Creation time
    """

    __tablename__ = "workflow_app_logs"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="workflow_app_log_pkey"),
        db.Index("workflow_app_log_app_idx", "tenant_id", "app_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    app_id: Mapped[str] = mapped_column(StringUUID)
    workflow_id = db.Column(StringUUID, nullable=False)
    workflow_run_id: Mapped[str] = mapped_column(StringUUID)
    created_from = db.Column(db.String(255), nullable=False)
    created_by_role = db.Column(db.String(255), nullable=False)
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def workflow_run(self):
        return db.session.get(WorkflowRun, self.workflow_run_id)

    @property
    def created_by_account(self):
        created_by_role = CreatedByRole(self.created_by_role)
        return db.session.get(Account, self.created_by) if created_by_role == CreatedByRole.ACCOUNT else None

    @property
    def created_by_end_user(self):
        from models.model import EndUser

        created_by_role = CreatedByRole(self.created_by_role)
        return db.session.get(EndUser, self.created_by) if created_by_role == CreatedByRole.END_USER else None


class ConversationVariable(Base):
    __tablename__ = "workflow_conversation_variables"
    __table_args__ = (
        PrimaryKeyConstraint("id", "conversation_id", name="workflow_conversation_variables_pkey"),
        Index("workflow__conversation_variables_app_id_idx", "app_id"),
        Index("workflow__conversation_variables_created_at_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(StringUUID, nullable=False, primary_key=True)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    data = mapped_column(db.Text, nullable=False)
    created_at = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = mapped_column(
        db.DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )

    def __init__(self, *, id: str, app_id: str, conversation_id: str, data: str) -> None:
        self.id = id
        self.app_id = app_id
        self.conversation_id = conversation_id
        self.data = data

    @classmethod
    def from_variable(cls, *, app_id: str, conversation_id: str, variable: Variable) -> "ConversationVariable":
        obj = cls(
            id=variable.id,
            app_id=app_id,
            conversation_id=conversation_id,
            data=variable.model_dump_json(),
        )
        return obj

    def to_variable(self) -> Variable:
        mapping = json.loads(self.data)
        return variable_factory.build_conversation_variable_from_mapping(mapping)
