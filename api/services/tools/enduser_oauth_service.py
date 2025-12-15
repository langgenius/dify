import logging
from typing import Any

from werkzeug import Request

from configs import dify_config
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.oauth import OAuthHandler
from core.tools.tool_manager import ToolManager
from models.provider_ids import ToolProviderID
from services.plugin.oauth_service import OAuthProxyService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.enduser_auth_service import EndUserAuthService

logger = logging.getLogger(__name__)


class EndUserOAuthService:
    """
    Service for managing end-user OAuth authentication flows.
    Reuses existing OAuthProxyService and OAuthHandler infrastructure.
    """

    @staticmethod
    def get_authorization_url(
        end_user_id: str,
        tenant_id: str,
        app_id: str,
        provider: str,
    ) -> dict[str, str]:
        """
        Initiate OAuth authorization flow for an end user.

        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :param app_id: The application ID
        :param provider: The provider identifier
        :return: Dict with authorization_url
        """
        try:
            # Get OAuth client configuration (reuse workspace-level logic)
            oauth_client = BuiltinToolManageService.get_oauth_client(tenant_id, provider)
            if not oauth_client:
                raise ValueError(f"OAuth client not configured for provider {provider}")

            # Get provider controller
            provider_controller = ToolManager.get_builtin_provider(provider, tenant_id)
            tool_provider_id = ToolProviderID(provider)

            # Create OAuth context with end-user specific data
            context_id = OAuthProxyService.create_proxy_context(
                user_id=end_user_id,  # Using end_user_id as user_id
                tenant_id=tenant_id,
                plugin_id=tool_provider_id.plugin_id,
                provider=tool_provider_id.provider_name,
                extra_data={
                    "app_id": app_id,
                    "provider_type": "tool",  # For now, only tools support end-user auth
                },
            )

            # Use the same redirect URI as workspace OAuth to reuse the same OAuth client
            redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{tool_provider_id}/tool/callback"

            # Get authorization URL from OAuth handler
            oauth_handler = OAuthHandler()
            response = oauth_handler.get_authorization_url(
                tenant_id=tenant_id,
                user_id=end_user_id,
                plugin_id=tool_provider_id.plugin_id,
                provider=tool_provider_id.provider_name,
                redirect_uri=redirect_uri,
                system_credentials=oauth_client,
            )

            return {
                "authorization_url": response.authorization_url,
                "context_id": context_id,  # Return for setting cookie
            }
        except Exception as e:
            logger.exception("Error getting authorization URL for end user")
            raise ValueError(f"Failed to initiate OAuth flow: {str(e)}")

    @staticmethod
    def handle_oauth_callback(
        context_id: str,
        request: Request,
    ) -> dict[str, Any]:
        """
        Handle OAuth callback and create credential.

        :param context_id: The OAuth context ID from cookie
        :param request: The callback request with authorization code
        :return: Dict with credential information
        """
        try:
            # Validate and retrieve context
            context = OAuthProxyService.use_proxy_context(context_id)

            # Extract context data
            end_user_id = context.get("user_id")  # user_id is actually end_user_id
            tenant_id = context.get("tenant_id")
            app_id = context.get("app_id")
            plugin_id = context.get("plugin_id")
            provider = context.get("provider")

            if not all([end_user_id, tenant_id, app_id, plugin_id, provider]):
                raise ValueError("Invalid OAuth context: missing required fields")

            # Reconstruct full provider ID
            full_provider = f"{plugin_id}/{provider}" if plugin_id != "langgenius" else provider

            # Get OAuth client configuration
            oauth_client = BuiltinToolManageService.get_oauth_client(tenant_id, full_provider)
            if not oauth_client:
                raise ValueError(f"OAuth client not configured for provider {full_provider}")

            # Use the same redirect URI as workspace OAuth (must match authorization request)
            redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{full_provider}/tool/callback"

            # Exchange authorization code for credentials
            oauth_handler = OAuthHandler()
            credentials_response = oauth_handler.get_credentials(
                tenant_id=tenant_id,
                user_id=end_user_id,
                plugin_id=plugin_id,
                provider=provider,
                redirect_uri=redirect_uri,
                system_credentials=oauth_client,
                request=request,
            )

            # Calculate expiration timestamp
            expires_at = -1
            if credentials_response.expires_in and credentials_response.expires_in > 0:
                import time

                expires_at = int(time.time()) + credentials_response.expires_in

            # Create credential in database
            credential = EndUserAuthService.create_oauth_credential(
                end_user_id=end_user_id,
                tenant_id=tenant_id,
                provider=full_provider,
                credentials=credentials_response.credentials,
                expires_at=expires_at,
            )

            return {
                "success": True,
                "credential_id": credential.id,
                "provider": full_provider,
                "app_id": app_id,
            }
        except Exception as e:
            logger.exception("Error handling OAuth callback for end user")
            raise ValueError(f"Failed to complete OAuth flow: {str(e)}")

    @staticmethod
    def refresh_oauth_token(
        credential_id: str,
        end_user_id: str,
        tenant_id: str,
    ) -> dict[str, Any]:
        """
        Refresh an expired OAuth token.

        :param credential_id: The credential ID
        :param end_user_id: The end user ID
        :param tenant_id: The tenant ID
        :return: Dict with refresh status
        """
        try:
            # Get existing credential
            credential = EndUserAuthService.get_credential(
                credential_id=credential_id,
                end_user_id=end_user_id,
                tenant_id=tenant_id,
                mask_credentials=False,  # Need full credentials for refresh
            )

            if not credential:
                raise ValueError(f"Credential {credential_id} not found")

            if credential.credential_type != CredentialType.OAUTH2:
                raise ValueError("Only OAuth credentials can be refreshed")

            # Get OAuth client configuration
            oauth_client = BuiltinToolManageService.get_oauth_client(tenant_id, credential.provider)
            if not oauth_client:
                raise ValueError(f"OAuth client not configured for provider {credential.provider}")

            # Get provider info
            tool_provider_id = ToolProviderID(credential.provider)
            # Use the same redirect URI as workspace OAuth to reuse the same OAuth client
            redirect_uri = f"{dify_config.CONSOLE_API_URL}/console/api/oauth/plugin/{credential.provider}/tool/callback"

            # Refresh credentials via OAuth handler
            oauth_handler = OAuthHandler()
            refreshed_response = oauth_handler.refresh_credentials(
                tenant_id=tenant_id,
                user_id=end_user_id,
                plugin_id=tool_provider_id.plugin_id,
                provider=tool_provider_id.provider_name,
                redirect_uri=redirect_uri,
                system_credentials=oauth_client,
                credentials=credential.credentials,
            )

            # Calculate new expiration timestamp
            expires_at = -1
            if refreshed_response.expires_in and refreshed_response.expires_in > 0:
                import time

                expires_at = int(time.time()) + refreshed_response.expires_in

            # Update credential in database
            updated_credential = EndUserAuthService.refresh_oauth_token(
                credential_id=credential_id,
                end_user_id=end_user_id,
                tenant_id=tenant_id,
                refreshed_credentials=refreshed_response.credentials,
                expires_at=expires_at,
            )

            return {
                "success": True,
                "credential_id": updated_credential.id,
                "expires_at": expires_at,
                "refreshed_at": int(updated_credential.updated_at.timestamp()),
            }
        except Exception:
            logger.exception("Error refreshing OAuth token for end user")
            return {
                "success": False,
                "error": "Failed to refresh token",
            }

    @staticmethod
    def get_oauth_client_info(tenant_id: str, provider: str) -> dict[str, Any]:
        """
        Get OAuth client information for a provider.
        Used to check if OAuth is available and configured.

        :param tenant_id: The tenant ID
        :param provider: The provider identifier
        :return: Dict with OAuth client info
        """
        try:
            # Check if OAuth client exists (either system or custom)
            oauth_client = BuiltinToolManageService.get_oauth_client(tenant_id, provider)

            return {
                "configured": oauth_client is not None,
                "system_configured": BuiltinToolManageService.is_oauth_system_client_exists(provider),
                "custom_configured": BuiltinToolManageService.is_oauth_custom_client_enabled(tenant_id, provider),
            }
        except Exception:
            logger.exception("Error getting OAuth client info")
            return {
                "configured": False,
                "system_configured": False,
                "custom_configured": False,
            }
