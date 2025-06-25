import json
import uuid

from core.plugin.impl.base import BasePluginClient
from extensions.ext_redis import redis_client


class OAuthProxyService(BasePluginClient):
    # Default max age for proxy context parameter in seconds
    __MAX_AGE__ = 5 * 60  # 5 minutes

    @staticmethod
    def create_proxy_context(user_id, tenant_id, plugin_id, provider):
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
        seconds, _ = redis_client.time()
        context_id = str(uuid.uuid4())
        data = {
            "user_id": user_id,
            "plugin_id": plugin_id,
            "tenant_id": tenant_id,
            "provider": provider,
            # encode redis time to avoid distribution time skew
            "timestamp": seconds,
        }
        # ignore nonce collision
        redis_client.setex(
            f"oauth_proxy_context:{context_id}",
            OAuthProxyService.__MAX_AGE__,
            json.dumps(data),
        )
        return context_id

    @staticmethod
    def use_proxy_context(context_id, max_age=__MAX_AGE__):
        """
        Validate the proxy context parameter.
        This checks if the context_id is valid and not expired.
        """
        if not context_id:
            raise ValueError("context_id is required")
        # get data from redis
        data = redis_client.getdel(f"oauth_proxy_context:{context_id}")
        if not data:
            raise ValueError("context_id is invalid")
        # check if data is expired
        seconds, _ = redis_client.time()
        state = json.loads(data)
        if state.get("timestamp") < seconds - max_age:
            raise ValueError("context_id is expired")
        return state
