from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING, Any, cast
from uuid import uuid4

import sqlalchemy as sa
from deprecated import deprecated
from sqlalchemy import ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ApiProviderSchemaType, WorkflowToolParameterConfiguration

from .base import TypeBase
from .engine import db
from .model import Account, App, Tenant
from .types import LongText, StringUUID

if TYPE_CHECKING:
    from core.entities.mcp_provider import MCPProviderEntity


# system level tool oauth client params (client_id, client_secret, etc.)
class ToolOAuthSystemClient(TypeBase):
    __tablename__ = "tool_oauth_system_clients"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tool_oauth_system_client_pkey"),
        sa.UniqueConstraint("plugin_id", "provider", name="tool_oauth_system_client_plugin_id_provider_idx"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    plugin_id: Mapped[str] = mapped_column(String(512), nullable=False)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    # oauth params of the tool provider
    encrypted_oauth_params: Mapped[str] = mapped_column(LongText, nullable=False)


# tenant level tool oauth client params (client_id, client_secret, etc.)
class ToolOAuthTenantClient(TypeBase):
    __tablename__ = "tool_oauth_tenant_clients"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tool_oauth_tenant_client_pkey"),
        sa.UniqueConstraint("tenant_id", "plugin_id", "provider", name="unique_tool_oauth_tenant_client"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    plugin_id: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"), init=False)
    # oauth params of the tool provider
    encrypted_oauth_params: Mapped[str] = mapped_column(LongText, nullable=False, init=False)

    @property
    def oauth_params(self) -> dict[str, Any]:
        return cast(dict[str, Any], json.loads(self.encrypted_oauth_params or "{}"))


class BuiltinToolProvider(TypeBase):
    """
    This table stores the tool provider information for built-in tools for each tenant.
    """

    __tablename__ = "tool_builtin_providers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tool_builtin_provider_pkey"),
        sa.UniqueConstraint("tenant_id", "provider", "name", name="unique_builtin_tool_provider"),
    )

    # id of the tool provider
    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    name: Mapped[str] = mapped_column(
        String(256),
        nullable=False,
        server_default=sa.text("'API KEY 1'"),
    )
    # id of the tenant
    tenant_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    # who created this tool provider
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # name of the tool provider
    provider: Mapped[str] = mapped_column(String(256), nullable=False)
    # credential of the tool provider
    encrypted_credentials: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )
    is_default: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"), default=False)
    # credential type, e.g., "api-key", "oauth2"
    credential_type: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=sa.text("'api-key'"), default="api-key"
    )
    expires_at: Mapped[int] = mapped_column(sa.BigInteger, nullable=False, server_default=sa.text("-1"), default=-1)

    @property
    def credentials(self) -> dict[str, Any]:
        if not self.encrypted_credentials:
            return {}
        return cast(dict[str, Any], json.loads(self.encrypted_credentials))


class ApiToolProvider(TypeBase):
    """
    The table stores the api providers.
    """

    __tablename__ = "tool_api_providers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tool_api_provider_pkey"),
        sa.UniqueConstraint("name", "tenant_id", name="unique_api_tool_provider"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # name of the api provider
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        server_default=sa.text("'API KEY 1'"),
    )
    # icon
    icon: Mapped[str] = mapped_column(String(255), nullable=False)
    # original schema
    schema: Mapped[str] = mapped_column(LongText, nullable=False)
    schema_type_str: Mapped[str] = mapped_column(String(40), nullable=False)
    # who created this tool
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # description of the provider
    description: Mapped[str] = mapped_column(LongText, nullable=False)
    # json format tools
    tools_str: Mapped[str] = mapped_column(LongText, nullable=False)
    # json format credentials
    credentials_str: Mapped[str] = mapped_column(LongText, nullable=False)
    # privacy policy
    privacy_policy: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    # custom_disclaimer
    custom_disclaimer: Mapped[str] = mapped_column(LongText, default="")

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )

    @property
    def schema_type(self) -> ApiProviderSchemaType:
        return ApiProviderSchemaType.value_of(self.schema_type_str)

    @property
    def tools(self) -> list[ApiToolBundle]:
        return [ApiToolBundle.model_validate(tool) for tool in json.loads(self.tools_str)]

    @property
    def credentials(self) -> dict[str, Any]:
        return dict[str, Any](json.loads(self.credentials_str))

    @property
    def user(self) -> Account | None:
        if not self.user_id:
            return None
        return db.session.query(Account).where(Account.id == self.user_id).first()

    @property
    def tenant(self) -> Tenant | None:
        return db.session.query(Tenant).where(Tenant.id == self.tenant_id).first()


class ToolLabelBinding(TypeBase):
    """
    The table stores the labels for tools.
    """

    __tablename__ = "tool_label_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tool_label_bind_pkey"),
        sa.UniqueConstraint("tool_id", "label_name", name="unique_tool_label_bind"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # tool id
    tool_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # tool type
    tool_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # label name
    label_name: Mapped[str] = mapped_column(String(40), nullable=False)


class WorkflowToolProvider(TypeBase):
    """
    The table stores the workflow providers.
    """

    __tablename__ = "tool_workflow_providers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tool_workflow_provider_pkey"),
        sa.UniqueConstraint("name", "tenant_id", name="unique_workflow_tool_provider"),
        sa.UniqueConstraint("tenant_id", "app_id", name="unique_workflow_tool_provider_app_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # name of the workflow provider
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # label of the workflow provider
    label: Mapped[str] = mapped_column(String(255), nullable=False, server_default="")
    # icon
    icon: Mapped[str] = mapped_column(String(255), nullable=False)
    # app id of the workflow provider
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # version of the workflow provider
    version: Mapped[str] = mapped_column(String(255), nullable=False, server_default="")
    # who created this tool
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # description of the provider
    description: Mapped[str] = mapped_column(LongText, nullable=False)
    # parameter configuration
    parameter_configuration: Mapped[str] = mapped_column(LongText, nullable=False, default="[]")
    # privacy policy
    privacy_policy: Mapped[str | None] = mapped_column(String(255), nullable=True, server_default="", default=None)

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )

    @property
    def user(self) -> Account | None:
        return db.session.query(Account).where(Account.id == self.user_id).first()

    @property
    def tenant(self) -> Tenant | None:
        return db.session.query(Tenant).where(Tenant.id == self.tenant_id).first()

    @property
    def parameter_configurations(self) -> list[WorkflowToolParameterConfiguration]:
        return [
            WorkflowToolParameterConfiguration.model_validate(config)
            for config in json.loads(self.parameter_configuration)
        ]

    @property
    def app(self) -> App | None:
        return db.session.query(App).where(App.id == self.app_id).first()


class MCPToolProvider(TypeBase):
    """
    The table stores the mcp providers.
    """

    __tablename__ = "tool_mcp_providers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tool_mcp_provider_pkey"),
        sa.UniqueConstraint("tenant_id", "server_url_hash", name="unique_mcp_provider_server_url"),
        sa.UniqueConstraint("tenant_id", "name", name="unique_mcp_provider_name"),
        sa.UniqueConstraint("tenant_id", "server_identifier", name="unique_mcp_provider_server_identifier"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # name of the mcp provider
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    # server identifier of the mcp provider
    server_identifier: Mapped[str] = mapped_column(String(64), nullable=False)
    # encrypted url of the mcp provider
    server_url: Mapped[str] = mapped_column(LongText, nullable=False)
    # hash of server_url for uniqueness check
    server_url_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # icon of the mcp provider
    icon: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # who created this tool
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # encrypted credentials
    encrypted_credentials: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)
    # authed
    authed: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    # tools
    tools: Mapped[str] = mapped_column(LongText, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )
    timeout: Mapped[float] = mapped_column(sa.Float, nullable=False, server_default=sa.text("30"), default=30.0)
    sse_read_timeout: Mapped[float] = mapped_column(
        sa.Float, nullable=False, server_default=sa.text("300"), default=300.0
    )
    # encrypted headers for MCP server requests
    encrypted_headers: Mapped[str | None] = mapped_column(LongText, nullable=True, default=None)

    def load_user(self) -> Account | None:
        return db.session.query(Account).where(Account.id == self.user_id).first()

    @property
    def credentials(self) -> dict[str, Any]:
        if not self.encrypted_credentials:
            return {}
        try:
            return json.loads(self.encrypted_credentials)
        except Exception:
            return {}

    @property
    def headers(self) -> dict[str, Any]:
        if self.encrypted_headers is None:
            return {}
        try:
            return json.loads(self.encrypted_headers)
        except Exception:
            return {}

    @property
    def tool_dict(self) -> list[dict[str, Any]]:
        try:
            return json.loads(self.tools) if self.tools else []
        except (json.JSONDecodeError, TypeError):
            return []

    def to_entity(self) -> MCPProviderEntity:
        """Convert to domain entity"""
        from core.entities.mcp_provider import MCPProviderEntity

        return MCPProviderEntity.from_db_model(self)


class ToolModelInvoke(TypeBase):
    """
    store the invoke logs from tool invoke
    """

    __tablename__ = "tool_model_invokes"
    __table_args__ = (sa.PrimaryKeyConstraint("id", name="tool_model_invoke_pkey"),)

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # who invoke this tool
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # provider
    provider: Mapped[str] = mapped_column(String(255), nullable=False)
    # type
    tool_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # tool name
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # invoke parameters
    model_parameters: Mapped[str] = mapped_column(LongText, nullable=False)
    # prompt messages
    prompt_messages: Mapped[str] = mapped_column(LongText, nullable=False)
    # invoke response
    model_response: Mapped[str] = mapped_column(LongText, nullable=False)

    prompt_tokens: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))
    answer_tokens: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))
    answer_unit_price: Mapped[Decimal] = mapped_column(sa.Numeric(10, 4), nullable=False)
    answer_price_unit: Mapped[Decimal] = mapped_column(
        sa.Numeric(10, 7), nullable=False, server_default=sa.text("0.001")
    )
    provider_response_latency: Mapped[float] = mapped_column(sa.Float, nullable=False, server_default=sa.text("0"))
    total_price: Mapped[Decimal | None] = mapped_column(sa.Numeric(10, 7))
    currency: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )


@deprecated
class ToolConversationVariables(TypeBase):
    """
    store the conversation variables from tool invoke
    """

    __tablename__ = "tool_conversation_variables"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tool_conversation_variables_pkey"),
        # add index for user_id and conversation_id
        sa.Index("user_id_idx", "user_id"),
        sa.Index("conversation_id_idx", "conversation_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # conversation user id
    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # conversation id
    conversation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # variables pool
    variables_str: Mapped[str] = mapped_column(LongText, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )

    @property
    def variables(self):
        return json.loads(self.variables_str)


class ToolFile(TypeBase):
    """This table stores file metadata generated in workflows,
    not only files created by agent.
    """

    __tablename__ = "tool_files"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tool_file_pkey"),
        sa.Index("tool_file_conversation_id_idx", "conversation_id"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # conversation user id
    user_id: Mapped[str] = mapped_column(StringUUID)
    # tenant id
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    # conversation id
    conversation_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    # file key
    file_key: Mapped[str] = mapped_column(String(255), nullable=False)
    # mime type
    mimetype: Mapped[str] = mapped_column(String(255), nullable=False)
    # original url
    original_url: Mapped[str | None] = mapped_column(String(2048), nullable=True, default=None)
    # name
    name: Mapped[str] = mapped_column(String(255), default="")
    # size
    size: Mapped[int] = mapped_column(sa.Integer, default=-1)


@deprecated
class DeprecatedPublishedAppTool(TypeBase):
    """
    The table stores the apps published as a tool for each person.
    """

    __tablename__ = "tool_published_apps"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="published_app_tool_pkey"),
        sa.UniqueConstraint("app_id", "user_id", name="unique_published_app_tool"),
    )

    id: Mapped[str] = mapped_column(
        StringUUID, insert_default=lambda: str(uuid4()), default_factory=lambda: str(uuid4()), init=False
    )
    # id of the app
    app_id: Mapped[str] = mapped_column(StringUUID, ForeignKey("apps.id"), nullable=False)

    user_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    # who published this tool
    description: Mapped[str] = mapped_column(LongText, nullable=False)
    # llm_description of the tool, for LLM
    llm_description: Mapped[str] = mapped_column(LongText, nullable=False)
    # query description, query will be seem as a parameter of the tool,
    # to describe this parameter to llm, we need this field
    query_description: Mapped[str] = mapped_column(LongText, nullable=False)
    # query name, the name of the query parameter
    query_name: Mapped[str] = mapped_column(String(40), nullable=False)
    # name of the tool provider
    tool_name: Mapped[str] = mapped_column(String(40), nullable=False)
    # author
    author: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), init=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        init=False,
    )

    @property
    def description_i18n(self) -> I18nObject:
        return I18nObject.model_validate(json.loads(self.description))
