import hashlib
import json
from datetime import datetime
from typing import Any

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from core.helper import encrypter
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.mcp.error import MCPAuthError, MCPError
from core.mcp.mcp_client import MCPClient
from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.mcp_tool.provider import MCPToolProviderController
from core.tools.utils.encryption import ProviderConfigEncrypter
from extensions.ext_database import db
from models.tools import MCPToolProvider
from services.tools.tools_transform_service import ToolTransformService

UNCHANGED_SERVER_URL_PLACEHOLDER = "[__HIDDEN__]"


class MCPToolManageService:
    """
    Service class for managing mcp tools.
    """

    @staticmethod
    def get_mcp_provider_by_provider_id(provider_id: str, tenant_id: str) -> MCPToolProvider:
        res = (
            db.session.query(MCPToolProvider)
            .filter(MCPToolProvider.tenant_id == tenant_id, MCPToolProvider.id == provider_id)
            .first()
        )
        if not res:
            raise ValueError("MCP tool not found")
        return res

    @staticmethod
    def get_mcp_provider_by_server_identifier(server_identifier: str, tenant_id: str) -> MCPToolProvider:
        res = (
            db.session.query(MCPToolProvider)
            .filter(MCPToolProvider.tenant_id == tenant_id, MCPToolProvider.server_identifier == server_identifier)
            .first()
        )
        if not res:
            raise ValueError("MCP tool not found")
        return res

    @staticmethod
    def create_mcp_provider(
        tenant_id: str,
        name: str,
        server_url: str,
        user_id: str,
        icon: str,
        icon_type: str,
        icon_background: str,
        server_identifier: str,
    ) -> ToolProviderApiEntity:
        server_url_hash = hashlib.sha256(server_url.encode()).hexdigest()
        existing_provider = (
            db.session.query(MCPToolProvider)
            .filter(
                MCPToolProvider.tenant_id == tenant_id,
                or_(
                    MCPToolProvider.name == name,
                    MCPToolProvider.server_url_hash == server_url_hash,
                    MCPToolProvider.server_identifier == server_identifier,
                ),
                MCPToolProvider.tenant_id == tenant_id,
            )
            .first()
        )
        if existing_provider:
            if existing_provider.name == name:
                raise ValueError(f"MCP tool {name} already exists")
            elif existing_provider.server_url_hash == server_url_hash:
                raise ValueError(f"MCP tool {server_url} already exists")
            elif existing_provider.server_identifier == server_identifier:
                raise ValueError(f"MCP tool {server_identifier} already exists")
        encrypted_server_url = encrypter.encrypt_token(tenant_id, server_url)
        mcp_tool = MCPToolProvider(
            tenant_id=tenant_id,
            name=name,
            server_url=encrypted_server_url,
            server_url_hash=server_url_hash,
            user_id=user_id,
            authed=False,
            tools="[]",
            icon=json.dumps({"content": icon, "background": icon_background}) if icon_type == "emoji" else icon,
            server_identifier=server_identifier,
        )
        db.session.add(mcp_tool)
        db.session.commit()
        return ToolTransformService.mcp_provider_to_user_provider(mcp_tool, for_list=True)

    @staticmethod
    def retrieve_mcp_tools(tenant_id: str, for_list: bool = False) -> list[ToolProviderApiEntity]:
        mcp_providers = (
            db.session.query(MCPToolProvider)
            .filter(MCPToolProvider.tenant_id == tenant_id)
            .order_by(MCPToolProvider.name)
            .all()
        )
        return [
            ToolTransformService.mcp_provider_to_user_provider(mcp_provider, for_list=for_list)
            for mcp_provider in mcp_providers
        ]

    @classmethod
    def list_mcp_tool_from_remote_server(cls, tenant_id: str, provider_id: str):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)

        try:
            with MCPClient(
                mcp_provider.decrypted_server_url, provider_id, tenant_id, authed=mcp_provider.authed, for_list=True
            ) as mcp_client:
                tools = mcp_client.list_tools()
        except MCPAuthError as e:
            raise ValueError("Please auth the tool first")
        except MCPError as e:
            raise ValueError(f"Failed to connect to MCP server: {e}")
        mcp_provider.tools = json.dumps([tool.model_dump() for tool in tools])
        mcp_provider.authed = True
        mcp_provider.updated_at = datetime.now()
        db.session.commit()
        user = mcp_provider.load_user()
        return ToolProviderApiEntity(
            id=mcp_provider.id,
            name=mcp_provider.name,
            tools=ToolTransformService.mcp_tool_to_user_tool(mcp_provider, tools),
            type=ToolProviderType.MCP,
            icon=mcp_provider.icon,
            author=user.name if user else "Anonymous",
            server_url=mcp_provider.masked_server_url,
            updated_at=int(mcp_provider.updated_at.timestamp()),
            description=I18nObject(en_US="", zh_Hans=""),
            label=I18nObject(en_US=mcp_provider.name, zh_Hans=mcp_provider.name),
            plugin_unique_identifier=mcp_provider.server_identifier,
        )

    @classmethod
    def delete_mcp_tool(cls, tenant_id: str, provider_id: str):
        mcp_tool = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)

        db.session.delete(mcp_tool)
        db.session.commit()

    @classmethod
    def update_mcp_provider(
        cls,
        tenant_id: str,
        provider_id: str,
        name: str,
        server_url: str,
        icon: str,
        icon_type: str,
        icon_background: str,
        server_identifier: str,
    ):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        mcp_provider.updated_at = datetime.now()
        mcp_provider.name = name
        mcp_provider.icon = (
            json.dumps({"content": icon, "background": icon_background}) if icon_type == "emoji" else icon
        )
        mcp_provider.server_identifier = server_identifier

        if UNCHANGED_SERVER_URL_PLACEHOLDER not in server_url:
            encrypted_server_url = encrypter.encrypt_token(tenant_id, server_url)
            mcp_provider.server_url = encrypted_server_url
            server_url_hash = hashlib.sha256(server_url.encode()).hexdigest()

            if server_url_hash != mcp_provider.server_url_hash:
                cls._re_connect_mcp_provider(mcp_provider, provider_id, tenant_id)
                mcp_provider.server_url_hash = server_url_hash
        try:
            db.session.commit()
        except IntegrityError as e:
            db.session.rollback()
            error_msg = str(e.orig)
            if "unique_mcp_provider_name" in error_msg:
                raise ValueError(f"MCP tool {name} already exists")
            elif "unique_mcp_provider_server_url" in error_msg:
                raise ValueError(f"MCP tool {server_url} already exists")
            elif "unique_mcp_provider_server_identifier" in error_msg:
                raise ValueError(f"MCP tool {server_identifier} already exists")
            else:
                raise

    @classmethod
    def update_mcp_provider_credentials(
        cls, mcp_provider: MCPToolProvider, credentials: dict[str, Any], authed: bool = False
    ):
        provider_controller = MCPToolProviderController._from_db(mcp_provider)
        tool_configuration = ProviderConfigEncrypter(
            tenant_id=mcp_provider.tenant_id,
            config=list(provider_controller.get_credentials_schema()),
            provider_config_cache=NoOpProviderCredentialCache(),
        )
        credentials = tool_configuration.encrypt(credentials)
        mcp_provider.updated_at = datetime.now()
        mcp_provider.encrypted_credentials = json.dumps({**mcp_provider.credentials, **credentials})
        mcp_provider.authed = authed
        if not authed:
            mcp_provider.tools = "[]"
        db.session.commit()

    @classmethod
    def _re_connect_mcp_provider(cls, mcp_provider: MCPToolProvider, provider_id: str, tenant_id: str):
        """re-connect mcp provider"""
        try:
            with MCPClient(
                mcp_provider.decrypted_server_url,
                provider_id,
                tenant_id,
                authed=False,
                for_list=True,
            ) as mcp_client:
                tools = mcp_client.list_tools()
                mcp_provider.authed = True
                mcp_provider.tools = json.dumps([tool.model_dump() for tool in tools])
        except MCPAuthError:
            mcp_provider.authed = False
            mcp_provider.tools = "[]"
        except MCPError as e:
            raise ValueError(f"Failed to re-connect MCP server: {e}") from e
        # reset credentials
        mcp_provider.encrypted_credentials = "{}"
