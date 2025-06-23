import hashlib
import json
from datetime import datetime
from urllib.parse import urlparse

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from core.helper import encrypter
from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.mcp_client import MCPClient
from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.mcp_tool.provider import MCPToolProviderController
from core.tools.utils.configuration import ProviderConfigEncrypter
from extensions.ext_database import db
from models.tools import MCPToolProvider
from services.tools.tools_transform_service import ToolTransformService


def mask_url(url: str, mask_char: str = "*"):
    """
    mask the url to a simple string
    """
    parsed = urlparse(url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    if parsed.path and parsed.path != "/":
        return f"{base_url}/{mask_char * 6}"
    else:
        return base_url


class MCPToolManageService:
    """
    Service class for managing mcp tools.
    """

    @staticmethod
    def get_mcp_provider_by_provider_id(provider_id: str, tenant_id: str) -> MCPToolProvider | None:
        return (
            db.session.query(MCPToolProvider)
            .filter(
                MCPToolProvider.id == provider_id,
                MCPToolProvider.tenant_id == tenant_id,
            )
            .first()
        )

    @staticmethod
    def create_mcp_provider(
        tenant_id: str, name: str, server_url: str, user_id: str, icon: str, icon_type: str, icon_background: str
    ) -> ToolProviderApiEntity:
        server_url_hash = hashlib.sha256(server_url.encode()).hexdigest()
        existing_provider = (
            db.session.query(MCPToolProvider)
            .filter(
                MCPToolProvider.tenant_id == tenant_id,
                or_(
                    MCPToolProvider.name == name,
                    MCPToolProvider.server_url_hash == server_url_hash,
                ),
                MCPToolProvider.tenant_id == tenant_id,
            )
            .first()
        )
        if existing_provider:
            if existing_provider.name == name:
                raise ValueError(f"MCP tool {name} already exists")
            else:
                raise ValueError(f"MCP tool {server_url} already exists")
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
        )
        db.session.add(mcp_tool)
        db.session.commit()
        return ToolTransformService.mcp_provider_to_user_provider(mcp_tool)

    @staticmethod
    def retrieve_mcp_tools(tenant_id: str) -> list[ToolProviderApiEntity]:
        mcp_providers = (
            db.session.query(MCPToolProvider)
            .filter(MCPToolProvider.tenant_id == tenant_id)
            .order_by(MCPToolProvider.name)
            .all()
        )
        return [ToolTransformService.mcp_provider_to_user_provider(mcp_provider) for mcp_provider in mcp_providers]

    @classmethod
    def list_mcp_tool_from_remote_server(cls, tenant_id: str, provider_id: str):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        server_url = cls.get_mcp_provider_server_url(tenant_id, provider_id)
        if mcp_provider is None:
            raise ValueError("MCP tool not found")
        try:
            with MCPClient(server_url, provider_id, tenant_id, authed=mcp_provider.authed) as mcp_client:
                tools = mcp_client.list_tools()
        except MCPAuthError as e:
            raise ValueError("Please auth the tool first")
        except MCPConnectionError as e:
            raise ValueError(f"Failed to connect to MCP server: {e}")
        mcp_provider.tools = json.dumps([tool.model_dump() for tool in tools])
        mcp_provider.authed = True
        mcp_provider.updated_at = datetime.now()
        db.session.commit()
        return ToolProviderApiEntity(
            id=mcp_provider.id,
            name=mcp_provider.name,
            tools=ToolTransformService.mcp_tool_to_user_tool(mcp_provider, tools),
            type=ToolProviderType.MCP,
            icon=mcp_provider.icon,
            author=mcp_provider.user.name if mcp_provider.user else "Anonymous",
            server_url=cls.get_masked_mcp_provider_server_url(tenant_id, provider_id),
            updated_at=int(mcp_provider.updated_at.timestamp()),
            description=I18nObject(en_US="", zh_Hans=""),
            label=I18nObject(en_US=mcp_provider.name, zh_Hans=mcp_provider.name),
        )

    @classmethod
    def retrieve_mcp_provider(cls, tenant_id: str, provider_id: str):
        provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if provider is None:
            raise ValueError("MCP tool not found")
        return ToolTransformService.mcp_provider_to_user_provider(provider).to_dict()

    @classmethod
    def delete_mcp_tool(cls, tenant_id: str, provider_id: str):
        mcp_tool = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if mcp_tool is None:
            raise ValueError("MCP tool not found")
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
    ):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if mcp_provider is None:
            raise ValueError("MCP tool not found")
        mcp_provider.name = name
        mcp_provider.icon = (
            json.dumps({"content": icon, "background": icon_background}) if icon_type == "emoji" else icon
        )
        if "[__HIDDEN__]" in server_url:
            db.session.commit()
            return
        encrypted_server_url = encrypter.encrypt_token(tenant_id, server_url)
        mcp_provider.server_url = encrypted_server_url
        server_url_hash = hashlib.sha256(server_url.encode()).hexdigest()
        # if the server url is changed, we need to re-auth the tool
        try:
            if server_url_hash != mcp_provider.server_url_hash:
                try:
                    with MCPClient(
                        server_url,
                        provider_id,
                        tenant_id,
                        authed=False,
                    ) as mcp_client:
                        tools = mcp_client.list_tools()
                        mcp_provider.authed = True
                        mcp_provider.tools = json.dumps([tool.model_dump() for tool in tools])
                except MCPAuthError:
                    mcp_provider.authed = False
                    mcp_provider.tools = "[]"
                mcp_provider.encrypted_credentials = "{}"
                mcp_provider.server_url_hash = server_url_hash

            db.session.commit()
        except IntegrityError as e:
            db.session.rollback()
            # Check if the error message contains the constraint name
            if "unique_mcp_provider_name" in str(e.orig):
                # Raise your custom exception
                raise ValueError(f"A provider with name '{name}' already exists.")
            elif "unique_mcp_provider_server_url" in str(e.orig):
                # You can define another custom exception for the other constraint
                raise ValueError(f"A provider for server URL '{server_url}' already exists.")
            else:
                # Re-raise the original exception if it's not the one you're handling
                raise

    @classmethod
    def update_mcp_provider_credentials(cls, tenant_id: str, provider_id: str, credentials: dict, authed: bool = False):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if mcp_provider is None:
            raise ValueError("MCP tool not found")
        provider_controller = MCPToolProviderController._from_db(mcp_provider)
        tool_configuration = ProviderConfigEncrypter(
            tenant_id=tenant_id,
            config=list(provider_controller.get_credentials_schema()),
            provider_type=provider_controller.provider_type.value,
            provider_identity=provider_controller.provider_id,
        )
        credentials = tool_configuration.encrypt(credentials)
        mcp_provider.encrypted_credentials = json.dumps({**mcp_provider.credentials, **credentials})
        mcp_provider.authed = authed
        db.session.commit()

    @classmethod
    def get_mcp_provider_decrypted_credentials(cls, tenant_id: str, provider_id: str):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if mcp_provider is None:
            raise ValueError("MCP tool not found")
        provider_controller = MCPToolProviderController._from_db(mcp_provider)
        tool_configuration = ProviderConfigEncrypter(
            tenant_id=tenant_id,
            config=list(provider_controller.get_credentials_schema()),
            provider_type=provider_controller.provider_type.value,
            provider_identity=provider_controller.provider_id,
        )
        return tool_configuration.decrypt(mcp_provider.credentials, use_cache=False)

    @classmethod
    def get_mcp_provider_server_url(cls, tenant_id: str, provider_id: str):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if mcp_provider is None:
            raise ValueError("MCP tool not found")
        return encrypter.decrypt_token(tenant_id, mcp_provider.server_url)

    @classmethod
    def get_masked_mcp_provider_server_url(cls, tenant_id: str, provider_id: str):
        server_url = cls.get_mcp_provider_server_url(tenant_id, provider_id)
        return mask_url(server_url)
