import json

from sqlalchemy import or_

from core.mcp.error import MCPAuthError, MCPConnectionError
from core.mcp.mcp_client import MCPClient
from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from extensions.ext_database import db
from models.tools import MCPToolProvider
from services.tools.tools_transform_service import ToolTransformService


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
    ) -> dict:
        existing_provider = (
            db.session.query(MCPToolProvider)
            .filter(
                MCPToolProvider.tenant_id == tenant_id,
                or_(MCPToolProvider.name == name, MCPToolProvider.server_url == server_url),
                MCPToolProvider.tenant_id == tenant_id,
            )
            .first()
        )
        if existing_provider:
            if existing_provider.name == name:
                raise ValueError(f"MCP tool {name} already exists")
            else:
                raise ValueError(f"MCP tool {server_url} already exists")

        mcp_tool = MCPToolProvider(
            tenant_id=tenant_id,
            name=name,
            server_url=server_url,
            user_id=user_id,
            authed=False,
            tools="[]",
            icon=json.dumps({"content": icon, "background": icon_background}) if icon_type == "emoji" else icon,
        )
        db.session.add(mcp_tool)
        db.session.commit()
        return {"result": "success"}

    @staticmethod
    def retrieve_mcp_tools(tenant_id: str) -> list[ToolProviderApiEntity]:
        mcp_providers = db.session.query(MCPToolProvider).filter(MCPToolProvider.tenant_id == tenant_id).all()
        return [ToolTransformService.mcp_provider_to_user_provider(mcp_provider) for mcp_provider in mcp_providers]

    @classmethod
    def list_mcp_tool_from_remote_server(cls, tenant_id: str, provider_id: str):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if mcp_provider is None:
            raise ValueError("MCP tool not found")
        try:
            with MCPClient(mcp_provider.server_url, provider_id, tenant_id, authed=mcp_provider.authed) as mcp_client:
                tools = mcp_client.list_tools()
        except MCPAuthError as e:
            raise ValueError("Please auth the tool first")
        except MCPConnectionError as e:
            raise ValueError(f"Failed to connect to MCP server: {e}")
        mcp_provider.tools = json.dumps([tool.model_dump() for tool in tools])
        mcp_provider.authed = True
        db.session.commit()
        return ToolProviderApiEntity(
            id=mcp_provider.id,
            name=mcp_provider.name,
            tools=ToolTransformService.mcp_tool_to_user_tool(mcp_provider, tools),
            type=ToolProviderType.MCP,
            icon=mcp_provider.icon,
            author=mcp_provider.user.name if mcp_provider.user else "Anonymous",
            server_url=mcp_provider.server_url,
            updated_at=mcp_provider.updated_at,
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
        return {"result": "success"}

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
        encrypted_credentials: dict,
    ):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if mcp_provider is None:
            raise ValueError("MCP tool not found")
        mcp_provider.name = name
        mcp_provider.server_url = server_url
        mcp_provider.icon = (
            json.dumps({"content": icon, "background": icon_background}) if icon_type == "emoji" else icon
        )
        mcp_provider.encrypted_credentials = json.dumps({**mcp_provider.credentials, **encrypted_credentials})
        db.session.commit()
        return {"result": "success"}

    @classmethod
    def update_mcp_provider_credentials(cls, tenant_id: str, provider_id: str, credentials: dict, authed: bool = False):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if mcp_provider is None:
            raise ValueError("MCP tool not found")
        mcp_provider.encrypted_credentials = json.dumps({**mcp_provider.credentials, **credentials})
        mcp_provider.authed = authed
        db.session.commit()
        return {"result": "success"}

    @classmethod
    def get_mcp_token(cls, provider_id: str, tenant_id: str):
        mcp_provider = cls.get_mcp_provider_by_provider_id(provider_id, tenant_id)
        if mcp_provider is None:
            raise ValueError("MCP provider not found")
        return mcp_provider.credentials.get("access_token", None)
