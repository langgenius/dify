import json
import uuid

from core.plugin.impl.base import BasePluginClient
from extensions.ext_redis import redis_client


class OAuthProxyService(BasePluginClient):
    # Default max age for proxy context parameter in seconds
    __MAX_AGE__ = 5 * 60  # 5 minutes
    __KEY_PREFIX__ = "oauth_proxy_context:"

    @staticmethod
    def create_proxy_context(
        user_id: str,
        tenant_id: str,
        plugin_id: str,
        provider: str,
        credential_id: str | None = None,
    ):
        """
        Create a proxy context for an OAuth 2.0 authorization request.

        This parameter is a crucial security measure to prevent Cross-Site Request
        Forgery (CSRF) attacks. It works by generating a unique nonce and storing it
        in a distributed cache (Redis) along with the user's session context.

        The returned nonce should be included as the 'proxy_context' parameter in the
        authorization URL. Upon callback, the `use_proxy_context` method
        is used to verify the state, ensuring the request's integrity and authenticity,
        and mitigating replay attacks.
        """
        context_id = str(uuid.uuid4())
        data = {
            "user_id": user_id,
            "plugin_id": plugin_id,
            "tenant_id": tenant_id,
            "provider": provider,
        }
        if credential_id:
            data["credential_id"] = credential_id
        redis_client.setex(
            f"{OAuthProxyService.__KEY_PREFIX__}{context_id}",
            OAuthProxyService.__MAX_AGE__,
            json.dumps(data),
        )
        return context_id

    @staticmethod
    def use_proxy_context(context_id: str):
        """
        Validate the proxy context parameter.
        This checks if the context_id is valid and not expired.
        """
        if not context_id:
            raise ValueError("context_id is required")
        # get data from redis
        key = f"{OAuthProxyService.__KEY_PREFIX__}{context_id}"
        data = redis_client.get(key)
        if not data:
            raise ValueError("context_id is invalid")
        redis_client.delete(key)
        return json.loads(data)
