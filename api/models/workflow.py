import json
import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from enum import Enum, StrEnum
from typing import TYPE_CHECKING, Any, Optional, Union
from uuid import uuid4

from flask_login import current_user
from sqlalchemy import orm

from core.file.constants import maybe_file_object
from core.file.models import File
from core.variables import utils as variable_utils
from core.variables.variables import FloatVariable, IntegerVariable, StringVariable
from core.workflow.constants import CONVERSATION_VARIABLE_NODE_ID, SYSTEM_VARIABLE_NODE_ID
from core.workflow.nodes.enums import NodeType
from factories.variable_factory import TypeMismatchError, build_segment_with_type
from libs.helper import extract_tenant_id

from ._workflow_exc import NodeNotFoundError, WorkflowDataError

if TYPE_CHECKING:
    from models.model import AppMode

import sqlalchemy as sa
from sqlalchemy import Index, PrimaryKeyConstraint, UniqueConstraint, func
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from constants import DEFAULT_FILE_NUMBER_LIMITS, HIDDEN_VALUE
from core.helper import encrypter
from core.variables import SecretVariable, Segment, SegmentType, Variable
from factories import variable_factory
from libs import helper

from .account import Account
from .base import Base
from .engine import db
from .enums import CreatorUserRole, DraftVariableType
from .types import EnumText, StringUUID

_logger = logging.getLogger(__name__)

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


class _InvalidGraphDefinitionError(Exception):
    pass


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
    version: Mapped[str] = mapped_column(db.String(255), nullable=False)
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

    VERSION_DRAFT = "draft"

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
    ) -> "Workflow":
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
        # TODO(QuantumGhost): Consider caching `graph_dict` to avoid repeated JSON decoding.
        #
        # Using `functools.cached_property` could help, but some code in the codebase may
        # modify the returned dict, which can cause issues elsewhere.
        #
        # For example, changing this property to a cached property led to errors like the
        # following when single stepping an `Iteration` node:
        #
        #     Root node id 1748401971780start not found in the graph
        #
        # There is currently no standard way to make a dict deeply immutable in Python,
        # and tracking modifications to the returned dict is difficult. For now, we leave
        # the code as-is to avoid these issues.
        #
        # Currently, the following functions / methods would mutate the returned dict:
        #
        # - `_get_graph_and_variable_pool_of_single_iteration`.
        # - `_get_graph_and_variable_pool_of_single_loop`.
        return json.loads(self.graph) if self.graph else {}

    def get_node_config_by_id(self, node_id: str) -> Mapping[str, Any]:
        """Extract a node configuration from the workflow graph by node ID.
        A node configuration is a dictionary containing the node's properties, including
        the node's id, title, and its data as a dict.
        """
        workflow_graph = self.graph_dict

        if not workflow_graph:
            raise WorkflowDataError(f"workflow graph not found, workflow_id={self.id}")

        nodes = workflow_graph.get("nodes")
        if not nodes:
            raise WorkflowDataError("nodes not found in workflow graph")

        try:
            node_config = next(filter(lambda node: node["id"] == node_id, nodes))
        except StopIteration:
            raise NodeNotFoundError(node_id)
        assert isinstance(node_config, dict)
        return node_config

    @staticmethod
    def get_node_type_from_node_config(node_config: Mapping[str, Any]) -> NodeType:
        """Extract type of a node from the node configuration returned by `get_node_config_by_id`."""
        node_config_data = node_config.get("data", {})
        # Get node class
        node_type = NodeType(node_config_data.get("type"))
        return node_type

    @staticmethod
    def get_enclosing_node_type_and_id(node_config: Mapping[str, Any]) -> tuple[NodeType, str] | None:
        in_loop = node_config.get("isInLoop", False)
        in_iteration = node_config.get("isInIteration", False)
        if in_loop:
            loop_id = node_config.get("loop_id")
            if loop_id is None:
                raise _InvalidGraphDefinitionError("invalid graph")
            return NodeType.LOOP, loop_id
        elif in_iteration:
            iteration_id = node_config.get("iteration_id")
            if iteration_id is None:
                raise _InvalidGraphDefinitionError("invalid graph")
            return NodeType.ITERATION, iteration_id
        else:
            return None

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
            image_number_limits = int(features["file_upload"]["image"].get("number_limits", DEFAULT_FILE_NUMBER_LIMITS))
            image_transfer_methods = features["file_upload"]["image"].get(
                "transfer_methods", ["remote_url", "local_file"]
            )
            features["file_upload"]["enabled"] = image_enabled
            features["file_upload"]["number_limits"] = image_number_limits
            features["file_upload"]["allowed_file_upload_methods"] = image_transfer_methods
            features["file_upload"]["allowed_file_types"] = features["file_upload"].get("allowed_file_types", ["image"])
            features["file_upload"]["allowed_file_extensions"] = features["file_upload"].get(
                "allowed_file_extensions", []
            )
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
        """
        DEPRECATED: This property is not accurate for determining if a workflow is published as a tool.
        It only checks if there's a WorkflowToolProvider for the app, not if this specific workflow version
        is the one being used by the tool.

        For accurate checking, use a direct query with tenant_id, app_id, and version.
        """
        from models.tools import WorkflowToolProvider

        return (
            db.session.query(WorkflowToolProvider)
            .filter(WorkflowToolProvider.tenant_id == self.tenant_id, WorkflowToolProvider.app_id == self.app_id)
            .count()
            > 0
        )

    @property
    def environment_variables(self) -> Sequence[StringVariable | IntegerVariable | FloatVariable | SecretVariable]:
        # TODO: find some way to init `self._environment_variables` when instance created.
        if self._environment_variables is None:
            self._environment_variables = "{}"

        # Get tenant_id from current_user (Account or EndUser)
        tenant_id = extract_tenant_id(current_user)

        if not tenant_id:
            return []

        environment_variables_dict: dict[str, Any] = json.loads(self._environment_variables)
        results = [
            variable_factory.build_environment_variable_from_mapping(v) for v in environment_variables_dict.values()
        ]

        # decrypt secret variables value
        def decrypt_func(var):
            if isinstance(var, SecretVariable):
                return var.model_copy(update={"value": encrypter.decrypt_token(tenant_id=tenant_id, token=var.value)})
            elif isinstance(var, (StringVariable, IntegerVariable, FloatVariable)):
                return var
            else:
                raise AssertionError("this statement should be unreachable.")

        decrypted_results: list[SecretVariable | StringVariable | IntegerVariable | FloatVariable] = list(
            map(decrypt_func, results)
        )
        return decrypted_results

    @environment_variables.setter
    def environment_variables(self, value: Sequence[Variable]):
        if not value:
            self._environment_variables = "{}"
            return

        # Get tenant_id from current_user (Account or EndUser)
        tenant_id = extract_tenant_id(current_user)

        if not tenant_id:
            self._environment_variables = "{}"
            return

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

    @staticmethod
    def version_from_datetime(d: datetime) -> str:
        return str(d)


class WorkflowRun(Base):
    """
    Workflow Run

    Attributes:

    - id (uuid) Run ID
    - tenant_id (uuid) Workspace ID
    - app_id (uuid) App ID

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
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    app_id: Mapped[str] = mapped_column(StringUUID)

    workflow_id: Mapped[str] = mapped_column(StringUUID)
    type: Mapped[str] = mapped_column(db.String(255))
    triggered_from: Mapped[str] = mapped_column(db.String(255))
    version: Mapped[str] = mapped_column(db.String(255))
    graph: Mapped[Optional[str]] = mapped_column(db.Text)
    inputs: Mapped[Optional[str]] = mapped_column(db.Text)
    status: Mapped[str] = mapped_column(db.String(255))  # running, succeeded, failed, stopped, partial-succeeded
    outputs: Mapped[Optional[str]] = mapped_column(sa.Text, default="{}")
    error: Mapped[Optional[str]] = mapped_column(db.Text)
    elapsed_time: Mapped[float] = mapped_column(db.Float, nullable=False, server_default=sa.text("0"))
    total_tokens: Mapped[int] = mapped_column(sa.BigInteger, server_default=sa.text("0"))
    total_steps: Mapped[int] = mapped_column(db.Integer, server_default=db.text("0"), nullable=True)
    created_by_role: Mapped[str] = mapped_column(db.String(255))  # account, end_user
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    finished_at: Mapped[Optional[datetime]] = mapped_column(db.DateTime)
    exceptions_count: Mapped[int] = mapped_column(db.Integer, server_default=db.text("0"), nullable=True)

    @property
    def created_by_account(self):
        created_by_role = CreatorUserRole(self.created_by_role)
        return db.session.get(Account, self.created_by) if created_by_role == CreatorUserRole.ACCOUNT else None

    @property
    def created_by_end_user(self):
        from models.model import EndUser

        created_by_role = CreatorUserRole(self.created_by_role)
        return db.session.get(EndUser, self.created_by) if created_by_role == CreatorUserRole.END_USER else None

    @property
    def graph_dict(self) -> Mapping[str, Any]:
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


class WorkflowNodeExecutionTriggeredFrom(StrEnum):
    """
    Workflow Node Execution Triggered From Enum
    """

    SINGLE_STEP = "single-step"
    WORKFLOW_RUN = "workflow-run"


class WorkflowNodeExecutionModel(Base):
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

    @declared_attr
    def __table_args__(cls):  # noqa
        return (
            PrimaryKeyConstraint("id", name="workflow_node_execution_pkey"),
            Index(
                "workflow_node_execution_workflow_run_idx",
                "tenant_id",
                "app_id",
                "workflow_id",
                "triggered_from",
                "workflow_run_id",
            ),
            Index(
                "workflow_node_execution_node_run_idx",
                "tenant_id",
                "app_id",
                "workflow_id",
                "triggered_from",
                "node_id",
            ),
            Index(
                "workflow_node_execution_id_idx",
                "tenant_id",
                "app_id",
                "workflow_id",
                "triggered_from",
                "node_execution_id",
            ),
            Index(
                # The first argument is the index name,
                # which we leave as `None`` to allow auto-generation by the ORM.
                None,
                cls.tenant_id,
                cls.workflow_id,
                cls.node_id,
                # MyPy may flag the following line because it doesn't recognize that
                # the `declared_attr` decorator passes the receiving class as the first
                # argument to this method, allowing us to reference class attributes.
                cls.created_at.desc(),  # type: ignore
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
        created_by_role = CreatorUserRole(self.created_by_role)
        # TODO(-LAN-): Avoid using db.session.get() here.
        return db.session.get(Account, self.created_by) if created_by_role == CreatorUserRole.ACCOUNT else None

    @property
    def created_by_end_user(self):
        from models.model import EndUser

        created_by_role = CreatorUserRole(self.created_by_role)
        # TODO(-LAN-): Avoid using db.session.get() here.
        return db.session.get(EndUser, self.created_by) if created_by_role == CreatorUserRole.END_USER else None

    @property
    def inputs_dict(self):
        return json.loads(self.inputs) if self.inputs else None

    @property
    def outputs_dict(self) -> dict[str, Any] | None:
        return json.loads(self.outputs) if self.outputs else None

    @property
    def process_data_dict(self):
        return json.loads(self.process_data) if self.process_data else None

    @property
    def execution_metadata_dict(self) -> dict[str, Any]:
        # When the metadata is unset, we return an empty dictionary instead of `None`.
        # This approach streamlines the logic for the caller, making it easier to handle
        # cases where metadata is absent.
        return json.loads(self.execution_metadata) if self.execution_metadata else {}

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
    workflow_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    workflow_run_id: Mapped[str] = mapped_column(StringUUID)
    created_from: Mapped[str] = mapped_column(db.String(255), nullable=False)
    created_by_role: Mapped[str] = mapped_column(db.String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def workflow_run(self):
        return db.session.get(WorkflowRun, self.workflow_run_id)

    @property
    def created_by_account(self):
        created_by_role = CreatorUserRole(self.created_by_role)
        return db.session.get(Account, self.created_by) if created_by_role == CreatorUserRole.ACCOUNT else None

    @property
    def created_by_end_user(self):
        from models.model import EndUser

        created_by_role = CreatorUserRole(self.created_by_role)
        return db.session.get(EndUser, self.created_by) if created_by_role == CreatorUserRole.END_USER else None


class ConversationVariable(Base):
    __tablename__ = "workflow_conversation_variables"

    id: Mapped[str] = mapped_column(StringUUID, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(StringUUID, nullable=False, primary_key=True, index=True)
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False, index=True)
    data: Mapped[str] = mapped_column(db.Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        db.DateTime, nullable=False, server_default=func.current_timestamp(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
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


# Only `sys.query` and `sys.files` could be modified.
_EDITABLE_SYSTEM_VARIABLE = frozenset(["query", "files"])


def _naive_utc_datetime():
    return datetime.now(UTC).replace(tzinfo=None)


class WorkflowDraftVariable(Base):
    """`WorkflowDraftVariable` record variables and outputs generated during
    debugging worfklow or chatflow.

    IMPORTANT: This model maintains multiple invariant rules that must be preserved.
    Do not instantiate this class directly with the constructor.

    Instead, use the factory methods (`new_conversation_variable`, `new_sys_variable`,
    `new_node_variable`) defined below to ensure all invariants are properly maintained.
    """

    @staticmethod
    def unique_app_id_node_id_name() -> list[str]:
        return [
            "app_id",
            "node_id",
            "name",
        ]

    __tablename__ = "workflow_draft_variables"
    __table_args__ = (UniqueConstraint(*unique_app_id_node_id_name()),)
    # Required for instance variable annotation.
    __allow_unmapped__ = True

    # id is the unique identifier of a draft variable.
    id: Mapped[str] = mapped_column(StringUUID, primary_key=True, server_default=db.text("uuid_generate_v4()"))

    created_at: Mapped[datetime] = mapped_column(
        db.DateTime,
        nullable=False,
        default=_naive_utc_datetime,
        server_default=func.current_timestamp(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        db.DateTime,
        nullable=False,
        default=_naive_utc_datetime,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )

    # "`app_id` maps to the `id` field in the `model.App` model."
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)

    # `last_edited_at` records when the value of a given draft variable
    # is edited.
    #
    # If it's not edited after creation, its value is `None`.
    last_edited_at: Mapped[datetime | None] = mapped_column(
        db.DateTime,
        nullable=True,
        default=None,
    )

    # The `node_id` field is special.
    #
    # If the variable is a conversation variable or a system variable, then the value of `node_id`
    # is `conversation` or `sys`, respective.
    #
    # Otherwise, if the variable is a variable belonging to a specific node, the value of `_node_id` is
    # the identity of correspond node in graph definition. An example of node id is `"1745769620734"`.
    #
    # However, there's one caveat. The id of the first "Answer" node in chatflow is "answer". (Other
    # "Answer" node conform the rules above.)
    node_id: Mapped[str] = mapped_column(sa.String(255), nullable=False, name="node_id")

    # From `VARIABLE_PATTERN`, we may conclude that the length of a top level variable is less than
    # 80 chars.
    #
    # ref: api/core/workflow/entities/variable_pool.py:18
    name: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    description: Mapped[str] = mapped_column(
        sa.String(255),
        default="",
        nullable=False,
    )

    selector: Mapped[str] = mapped_column(sa.String(255), nullable=False, name="selector")

    # The data type of this variable's value
    value_type: Mapped[SegmentType] = mapped_column(EnumText(SegmentType, length=20))

    # The variable's value serialized as a JSON string
    value: Mapped[str] = mapped_column(sa.Text, nullable=False, name="value")

    # Controls whether the variable should be displayed in the variable inspection panel
    visible: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)

    # Determines whether this variable can be modified by users
    editable: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)

    # The `node_execution_id` field identifies the workflow node execution that created this variable.
    # It corresponds to the `id` field in the `WorkflowNodeExecutionModel` model.
    #
    # This field is not `None` for system variables and node variables, and is  `None`
    # for conversation variables.
    node_execution_id: Mapped[str | None] = mapped_column(
        StringUUID,
        nullable=True,
        default=None,
    )

    # Cache for deserialized value
    #
    # NOTE(QuantumGhost): This field serves two purposes:
    #
    # 1. Caches deserialized values to reduce repeated parsing costs
    # 2. Allows modification of the deserialized value after retrieval,
    #    particularly important for `File`` variables which require database
    #    lookups to obtain storage_key and other metadata
    #
    # Use double underscore prefix for better encapsulation,
    # making this attribute harder to access from outside the class.
    __value: Segment | None

    def __init__(self, *args, **kwargs):
        """
        The constructor of `WorkflowDraftVariable` is not intended for
        direct use outside this file. Its solo purpose is setup private state
        used by the model instance.

        Please use the factory methods
        (`new_conversation_variable`, `new_sys_variable`, `new_node_variable`)
        defined below to create instances of this class.
        """
        super().__init__(*args, **kwargs)
        self.__value = None

    @orm.reconstructor
    def _init_on_load(self):
        self.__value = None

    def get_selector(self) -> list[str]:
        selector = json.loads(self.selector)
        if not isinstance(selector, list):
            _logger.error(
                "invalid selector loaded from database, type=%s, value=%s",
                type(selector),
                self.selector,
            )
            raise ValueError("invalid selector.")
        return selector

    def _set_selector(self, value: list[str]):
        self.selector = json.dumps(value)

    def _loads_value(self) -> Segment:
        value = json.loads(self.value)
        return self.build_segment_with_type(self.value_type, value)

    @staticmethod
    def rebuild_file_types(value: Any) -> Any:
        # NOTE(QuantumGhost): Temporary workaround for structured data handling.
        # By this point, `output` has been converted to dict by
        # `WorkflowEntry.handle_special_values`, so we need to
        # reconstruct File objects from their serialized form
        # to maintain proper variable saving behavior.
        #
        # Ideally, we should work with structured data objects directly
        # rather than their serialized forms.
        # However, multiple components in the codebase depend on
        # `WorkflowEntry.handle_special_values`, making a comprehensive migration challenging.
        if isinstance(value, dict):
            if not maybe_file_object(value):
                return value
            return File.model_validate(value)
        elif isinstance(value, list) and value:
            first = value[0]
            if not maybe_file_object(first):
                return value
            return [File.model_validate(i) for i in value]
        else:
            return value

    @classmethod
    def build_segment_with_type(cls, segment_type: SegmentType, value: Any) -> Segment:
        # Extends `variable_factory.build_segment_with_type` functionality by
        # reconstructing `FileSegment`` or `ArrayFileSegment`` objects from
        # their serialized dictionary or list representations, respectively.
        if segment_type == SegmentType.FILE:
            if isinstance(value, File):
                return build_segment_with_type(segment_type, value)
            elif isinstance(value, dict):
                file = cls.rebuild_file_types(value)
                return build_segment_with_type(segment_type, file)
            else:
                raise TypeMismatchError(f"expected dict or File for FileSegment, got {type(value)}")
        if segment_type == SegmentType.ARRAY_FILE:
            if not isinstance(value, list):
                raise TypeMismatchError(f"expected list for ArrayFileSegment, got {type(value)}")
            file_list = cls.rebuild_file_types(value)
            return build_segment_with_type(segment_type=segment_type, value=file_list)

        return build_segment_with_type(segment_type=segment_type, value=value)

    def get_value(self) -> Segment:
        """Decode the serialized value into its corresponding `Segment` object.

        This method caches the result, so repeated calls will return the same
        object instance without re-parsing the serialized data.

        If you need to modify the returned `Segment`, use `value.model_copy()`
        to create a copy first to avoid affecting the cached instance.

        For more information about the caching mechanism, see the documentation
        of the `__value` field.

        Returns:
            Segment: The deserialized value as a Segment object.
        """

        if self.__value is not None:
            return self.__value
        value = self._loads_value()
        self.__value = value
        return value

    def set_name(self, name: str):
        self.name = name
        self._set_selector([self.node_id, name])

    def set_value(self, value: Segment):
        """Updates the `value` and corresponding `value_type` fields in the database model.

        This method also stores the provided Segment object in the deserialized cache
        without creating a copy, allowing for efficient value access.

        Args:
            value: The Segment object to store as the variable's value.
        """
        self.__value = value
        self.value = json.dumps(value, cls=variable_utils.SegmentJSONEncoder)
        self.value_type = value.value_type

    def get_node_id(self) -> str | None:
        if self.get_variable_type() == DraftVariableType.NODE:
            return self.node_id
        else:
            return None

    def get_variable_type(self) -> DraftVariableType:
        match self.node_id:
            case DraftVariableType.CONVERSATION:
                return DraftVariableType.CONVERSATION
            case DraftVariableType.SYS:
                return DraftVariableType.SYS
            case _:
                return DraftVariableType.NODE

    @classmethod
    def _new(
        cls,
        *,
        app_id: str,
        node_id: str,
        name: str,
        value: Segment,
        node_execution_id: str | None,
        description: str = "",
    ) -> "WorkflowDraftVariable":
        variable = WorkflowDraftVariable()
        variable.created_at = _naive_utc_datetime()
        variable.updated_at = _naive_utc_datetime()
        variable.description = description
        variable.app_id = app_id
        variable.node_id = node_id
        variable.name = name
        variable.set_value(value)
        variable._set_selector(list(variable_utils.to_selector(node_id, name)))
        variable.node_execution_id = node_execution_id
        return variable

    @classmethod
    def new_conversation_variable(
        cls,
        *,
        app_id: str,
        name: str,
        value: Segment,
        description: str = "",
    ) -> "WorkflowDraftVariable":
        variable = cls._new(
            app_id=app_id,
            node_id=CONVERSATION_VARIABLE_NODE_ID,
            name=name,
            value=value,
            description=description,
            node_execution_id=None,
        )
        variable.editable = True
        return variable

    @classmethod
    def new_sys_variable(
        cls,
        *,
        app_id: str,
        name: str,
        value: Segment,
        node_execution_id: str,
        editable: bool = False,
    ) -> "WorkflowDraftVariable":
        variable = cls._new(
            app_id=app_id,
            node_id=SYSTEM_VARIABLE_NODE_ID,
            name=name,
            node_execution_id=node_execution_id,
            value=value,
        )
        variable.editable = editable
        return variable

    @classmethod
    def new_node_variable(
        cls,
        *,
        app_id: str,
        node_id: str,
        name: str,
        value: Segment,
        node_execution_id: str,
        visible: bool = True,
        editable: bool = True,
    ) -> "WorkflowDraftVariable":
        variable = cls._new(
            app_id=app_id,
            node_id=node_id,
            name=name,
            node_execution_id=node_execution_id,
            value=value,
        )
        variable.visible = visible
        variable.editable = editable
        return variable

    @property
    def edited(self):
        return self.last_edited_at is not None


def is_system_variable_editable(name: str) -> bool:
    return name in _EDITABLE_SYSTEM_VARIABLE
