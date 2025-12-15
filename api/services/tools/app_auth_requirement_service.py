import logging
from typing import Any

from sqlalchemy.orm import Session

from core.tools.tool_manager import ToolManager
from extensions.ext_database import db
from models.workflow import Workflow
from services.tools.enduser_auth_service import EndUserAuthService

logger = logging.getLogger(__name__)


class AppAuthRequirementService:
    """
    Service for analyzing authentication requirements in apps.
    Examines workflow DSL to identify which providers need end-user authentication.
    """

    @staticmethod
    def get_tool_auth_requirements(
        app_id: str,
        tenant_id: str,
        provider_type: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Get all authentication requirements for tools in an app.

        :param app_id: The application ID
        :param tenant_id: The tenant ID
        :param provider_type: Optional filter by provider type (e.g., "tool")
        :return: List of provider requirements
        """
        try:
            # Get latest published workflow for the app
            with Session(db.engine, autoflush=False) as session:
                workflow = (
                    session.query(Workflow)
                    .filter_by(app_id=app_id, tenant_id=tenant_id)
                    .order_by(Workflow.created_at.desc())
                    .first()
                )

                if not workflow:
                    return []

                # Parse workflow graph to find tool nodes
                graph = workflow.graph_dict
                if not graph or "nodes" not in graph:
                    return []

                providers = []
                seen_providers = set()

                # Iterate through workflow nodes
                for node in graph.get("nodes", []):
                    node_data = node.get("data", {})
                    node_type = node_data.get("type")

                    # Check if it's a tool node
                    if node_type == "tool":
                        provider_id = node_data.get("provider_id")
                        provider_name = node_data.get("provider_name")
                        tool_name = node_data.get("tool_name")

                        if not provider_id:
                            continue

                        # Avoid duplicates
                        if provider_id in seen_providers:
                            continue

                        seen_providers.add(provider_id)

                        # Get provider controller to check authentication requirements
                        try:
                            provider_controller = ToolManager.get_builtin_provider(provider_id, tenant_id)

                            # Check if provider needs credentials
                            if not provider_controller.need_credentials:
                                continue

                            # Get supported credential types
                            supported_types = provider_controller.get_supported_credential_types()

                            # Determine required credential type (prefer OAuth if supported)
                            required_type = None
                            if supported_types:
                                # Prefer OAuth2, then API key
                                from core.plugin.entities.plugin_daemon import CredentialType

                                if CredentialType.OAUTH2 in supported_types:
                                    required_type = "oauth2"
                                elif CredentialType.API_KEY in supported_types:
                                    required_type = "api-key"
                                else:
                                    required_type = supported_types[0].value

                            providers.append(
                                {
                                    "provider_id": provider_id,
                                    "provider_name": provider_name or provider_id,
                                    "supported_credential_types": [ct.value for ct in supported_types],
                                    "required_credential_type": required_type,
                                    "provider_type": "tool",
                                    "feature_context": {
                                        "node_ids": [node.get("id")],
                                        "tool_names": [tool_name] if tool_name else [],
                                    },
                                }
                            )
                        except Exception as e:
                            logger.warning("Error getting provider info for %s: %s", provider_id, e)
                            continue

                # Filter by provider_type if specified
                if provider_type:
                    providers = [p for p in providers if p.get("provider_type") == provider_type]

                return providers
        except Exception:
            logger.exception("Error getting auth requirements for app %s", app_id)
            return []

    @staticmethod
    def get_required_providers(
        tenant_id: str,
        app_id: str,
    ) -> list[dict[str, Any]]:
        """
        Get list of providers that require end-user authentication for an app.
        Simplified version of get_tool_auth_requirements for API use.

        :param tenant_id: The tenant ID
        :param app_id: The application ID
        :return: List of provider information dictionaries
        """
        requirements = AppAuthRequirementService.get_tool_auth_requirements(
            app_id=app_id,
            tenant_id=tenant_id,
        )

        # Transform to simpler format for API response
        return [
            {
                "provider_id": req["provider_id"],
                "provider_name": req["provider_name"],
                "credential_type": req["required_credential_type"],
                "is_required": True,
                "oauth_config": None if req["required_credential_type"] != "oauth2" else {
                    "supported_types": req["supported_credential_types"],
                },
            }
            for req in requirements
        ]

    @staticmethod
    def get_auth_status(
        app_id: str,
        end_user_id: str,
        tenant_id: str,
    ) -> dict[str, Any]:
        """
        Get overall authentication status for an app and end user.
        Shows which providers are authenticated and which need authentication.

        :param app_id: The application ID
        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :return: Dict with authentication status for all providers
        """
        try:
            # Get required providers for this app
            required_providers = AppAuthRequirementService.get_tool_auth_requirements(app_id, tenant_id)

            # Check authentication status for each provider
            provider_statuses = []
            for provider_info in required_providers:
                provider_id = provider_info["provider_id"]

                # Get credentials for this provider
                credentials = EndUserAuthService.list_credentials(tenant_id, end_user_id, provider_id)

                # Build status
                provider_status = {
                    "provider_id": provider_id,
                    "provider_name": provider_info["provider_name"],
                    "provider_type": provider_info["provider_type"],
                    "authenticated": len(credentials) > 0,
                    "credentials": [
                        {
                            "credential_id": cred.id,
                            "name": cred.name,
                            "type": cred.credential_type.value,
                            "is_default": cred.is_default,
                            "expires_at": cred.expires_at,
                        }
                        for cred in credentials
                    ],
                }

                provider_statuses.append(provider_status)

            return {"providers": provider_statuses}
        except Exception:
            logger.exception("Error getting auth status for app %s", app_id)
            return {"providers": []}

    @staticmethod
    def is_provider_authenticated(
        provider_id: str,
        end_user_id: str,
        tenant_id: str,
    ) -> bool:
        """
        Check if a specific provider is authenticated for an end user.

        :param provider_id: The provider identifier
        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :return: True if authenticated, False otherwise
        """
        try:
            credentials = EndUserAuthService.list_credentials(tenant_id, end_user_id, provider_id)
            return len(credentials) > 0
        except Exception:
            return False
