import json
from datetime import datetime
from typing import Any, Optional, cast

import sqlalchemy as sa
from deprecated import deprecated
from sqlalchemy import ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ApiProviderSchemaType, WorkflowToolParameterConfiguration
from models.base import Base

from .engine import db
from .model import Account, App, Tenant
from .types import StringUUID


class BuiltinToolProvider(Base):
    """
    This table stores the tool provider information for built-in tools for each tenant.
    """

    __tablename__ = "tool_builtin_providers"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tool_builtin_provider_pkey"),
        # one tenant can only have one tool provider with the same name
        db.UniqueConstraint("tenant_id", "provider", name="unique_builtin_tool_provider"),
    )

    # id of the tool provider
    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    # id of the tenant
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=True)
    # who created this tool provider
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # name of the tool provider
    provider: Mapped[str] = mapped_column(db.String(256), nullable=False)
    # credential of the tool provider
    encrypted_credentials: Mapped[str] = mapped_column(db.Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        db.DateTime, nullable=False, server_default=db.text("CURRENT_TIMESTAMP(0)")
    )
    updated_at: Mapped[datetime] = mapped_column(
        db.DateTime, nullable=False, server_default=db.text("CURRENT_TIMESTAMP(0)")
    )

    @property
    def credentials(self) -> dict:
        return cast(dict, json.loads(self.encrypted_credentials))


class ApiToolProvider(Base):
    """
    The table stores the api providers.
    """

    __tablename__ = "tool_api_providers"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tool_api_provider_pkey"),
        db.UniqueConstraint("name", "tenant_id", name="unique_api_tool_provider"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    # name of the api provider
    name = db.Column(db.String(255), nullable=False)
    # icon
    icon = db.Column(db.String(255), nullable=False)
    # original schema
    schema = db.Column(db.Text, nullable=False)
    schema_type_str: Mapped[str] = db.Column(db.String(40), nullable=False)
    # who created this tool
    user_id = db.Column(StringUUID, nullable=False)
    # tenant id
    tenant_id = db.Column(StringUUID, nullable=False)
    # description of the provider
    description = db.Column(db.Text, nullable=False)
    # json format tools
    tools_str = db.Column(db.Text, nullable=False)
    # json format credentials
    credentials_str = db.Column(db.Text, nullable=False)
    # privacy policy
    privacy_policy = db.Column(db.String(255), nullable=True)
    # custom_disclaimer
    custom_disclaimer: Mapped[str] = mapped_column(sa.TEXT, default="")

    created_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def schema_type(self) -> ApiProviderSchemaType:
        return ApiProviderSchemaType.value_of(self.schema_type_str)

    @property
    def tools(self) -> list[ApiToolBundle]:
        return [ApiToolBundle(**tool) for tool in json.loads(self.tools_str)]

    @property
    def credentials(self) -> dict:
        return dict(json.loads(self.credentials_str))

    @property
    def user(self) -> Account | None:
        return db.session.query(Account).filter(Account.id == self.user_id).first()

    @property
    def tenant(self) -> Tenant | None:
        return db.session.query(Tenant).filter(Tenant.id == self.tenant_id).first()


class ToolLabelBinding(Base):
    """
    The table stores the labels for tools.
    """

    __tablename__ = "tool_label_bindings"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tool_label_bind_pkey"),
        db.UniqueConstraint("tool_id", "label_name", name="unique_tool_label_bind"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    # tool id
    tool_id: Mapped[str] = mapped_column(db.String(64), nullable=False)
    # tool type
    tool_type: Mapped[str] = mapped_column(db.String(40), nullable=False)
    # label name
    label_name: Mapped[str] = mapped_column(db.String(40), nullable=False)


class WorkflowToolProvider(Base):
    """
    The table stores the workflow providers.
    """

    __tablename__ = "tool_workflow_providers"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tool_workflow_provider_pkey"),
        db.UniqueConstraint("name", "tenant_id", name="unique_workflow_tool_provider"),
        db.UniqueConstraint("tenant_id", "app_id", name="unique_workflow_tool_provider_app_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    # name of the workflow provider
    name: Mapped[str] = mapped_column(db.String(255), nullable=False)
    # label of the workflow provider
    label: Mapped[str] = mapped_column(db.String(255), nullable=False, server_default="")
    # icon
    icon: Mapped[str] = mapped_column(db.String(255), nullable=False)
    # app id of the workflow provider
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # version of the workflow provider
    version: Mapped[str] = mapped_column(db.String(255), nullable=False, server_default="")
    # who created this tool
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # description of the provider
    description: Mapped[str] = mapped_column(db.Text, nullable=False)
    # parameter configuration
    parameter_configuration: Mapped[str] = mapped_column(db.Text, nullable=False, server_default="[]")
    # privacy policy
    privacy_policy: Mapped[str] = mapped_column(db.String(255), nullable=True, server_default="")

    created_at: Mapped[datetime] = mapped_column(
        db.DateTime, nullable=False, server_default=db.text("CURRENT_TIMESTAMP(0)")
    )
    updated_at: Mapped[datetime] = mapped_column(
        db.DateTime, nullable=False, server_default=db.text("CURRENT_TIMESTAMP(0)")
    )

    @property
    def schema_type(self) -> ApiProviderSchemaType:
        return ApiProviderSchemaType.value_of(self.schema_type_str)

    @property
    def user(self) -> Account | None:
        return db.session.query(Account).filter(Account.id == self.user_id).first()

    @property
    def tenant(self) -> Tenant | None:
        return db.session.query(Tenant).filter(Tenant.id == self.tenant_id).first()

    @property
    def parameter_configurations(self) -> list[WorkflowToolParameterConfiguration]:
        return [WorkflowToolParameterConfiguration(**config) for config in json.loads(self.parameter_configuration)]

    @property
    def app(self) -> App | None:
        return db.session.query(App).filter(App.id == self.app_id).first()


class ToolModelInvoke(Base):
    """
    store the invoke logs from tool invoke
    """

    __tablename__ = "tool_model_invokes"
    __table_args__ = (db.PrimaryKeyConstraint("id", name="tool_model_invoke_pkey"),)

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    # who invoke this tool
    user_id = db.Column(StringUUID, nullable=False)
    # tenant id
    tenant_id = db.Column(StringUUID, nullable=False)
    # provider
    provider = db.Column(db.String(255), nullable=False)
    # type
    tool_type = db.Column(db.String(40), nullable=False)
    # tool name
    tool_name = db.Column(db.String(40), nullable=False)
    # invoke parameters
    model_parameters = db.Column(db.Text, nullable=False)
    # prompt messages
    prompt_messages = db.Column(db.Text, nullable=False)
    # invoke response
    model_response = db.Column(db.Text, nullable=False)

    prompt_tokens = db.Column(db.Integer, nullable=False, server_default=db.text("0"))
    answer_tokens = db.Column(db.Integer, nullable=False, server_default=db.text("0"))
    answer_unit_price = db.Column(db.Numeric(10, 4), nullable=False)
    answer_price_unit = db.Column(db.Numeric(10, 7), nullable=False, server_default=db.text("0.001"))
    provider_response_latency = db.Column(db.Float, nullable=False, server_default=db.text("0"))
    total_price = db.Column(db.Numeric(10, 7))
    currency = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


@deprecated
class ToolConversationVariables(Base):
    """
    store the conversation variables from tool invoke
    """

    __tablename__ = "tool_conversation_variables"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tool_conversation_variables_pkey"),
        # add index for user_id and conversation_id
        db.Index("user_id_idx", "user_id"),
        db.Index("conversation_id_idx", "conversation_id"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    # conversation user id
    user_id = db.Column(StringUUID, nullable=False)
    # tenant id
    tenant_id = db.Column(StringUUID, nullable=False)
    # conversation id
    conversation_id = db.Column(StringUUID, nullable=False)
    # variables pool
    variables_str = db.Column(db.Text, nullable=False)

    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def variables(self) -> Any:
        return json.loads(self.variables_str)


class ToolFile(Base):
    """
    store the file created by agent
    """

    __tablename__ = "tool_files"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tool_file_pkey"),
        db.Index("tool_file_conversation_id_idx", "conversation_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    # conversation user id
    user_id: Mapped[str] = mapped_column(StringUUID)
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    # conversation id
    conversation_id: Mapped[str] = mapped_column(StringUUID, nullable=True)
    # file key
    file_key: Mapped[str] = mapped_column(db.String(255), nullable=False)
    # mime type
    mimetype: Mapped[str] = mapped_column(db.String(255), nullable=False)
    # original url
    original_url: Mapped[str] = mapped_column(db.String(2048), nullable=True)
    # name
    name: Mapped[str] = mapped_column(default="")
    # size
    size: Mapped[int] = mapped_column(default=-1)


@deprecated
class DeprecatedPublishedAppTool(Base):
    """
    The table stores the apps published as a tool for each person.
    """

    __tablename__ = "tool_published_apps"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="published_app_tool_pkey"),
        db.UniqueConstraint("app_id", "user_id", name="unique_published_app_tool"),
    )

    # id of the app
    app_id = db.Column(StringUUID, ForeignKey("apps.id"), nullable=False)
    # who published this tool
    description = db.Column(db.Text, nullable=False)
    # llm_description of the tool, for LLM
    llm_description = db.Column(db.Text, nullable=False)
    # query description, query will be seem as a parameter of the tool,
    # to describe this parameter to llm, we need this field
    query_description = db.Column(db.Text, nullable=False)
    # query name, the name of the query parameter
    query_name = db.Column(db.String(40), nullable=False)
    # name of the tool provider
    tool_name = db.Column(db.String(40), nullable=False)
    # author
    author = db.Column(db.String(40), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.text("CURRENT_TIMESTAMP(0)"))
    updated_at = db.Column(db.DateTime, nullable=False, server_default=db.text("CURRENT_TIMESTAMP(0)"))

    @property
    def description_i18n(self) -> I18nObject:
        return I18nObject(**json.loads(self.description))

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    user_id: Mapped[str] = db.Column(StringUUID, nullable=False)
    tenant_id: Mapped[str] = db.Column(StringUUID, nullable=False)
    conversation_id: Mapped[Optional[str]] = db.Column(StringUUID, nullable=True)
    file_key: Mapped[str] = db.Column(db.String(255), nullable=False)
    mimetype: Mapped[str] = db.Column(db.String(255), nullable=False)
    original_url: Mapped[Optional[str]] = db.Column(db.String(2048), nullable=True)
    name: Mapped[str] = mapped_column(default="")
    size: Mapped[int] = mapped_column(default=-1)

    def __init__(
        self,
        *,
        user_id: str,
        tenant_id: str,
        conversation_id: Optional[str] = None,
        file_key: str,
        mimetype: str,
        original_url: Optional[str] = None,
        name: str,
        size: int,
    ):
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.conversation_id = conversation_id
        self.file_key = file_key
        self.mimetype = mimetype
        self.original_url = original_url
        self.name = name
        self.size = size
