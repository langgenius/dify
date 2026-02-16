"""
AI Classification Tool Provider

This provider integrates with the NeuroSD classification API to classify
text into service and type categories. No authentication is required.
"""

from typing import Any

from core.tools.builtin_tool.provider import BuiltinToolProviderController


class AIClassificationToolProvider(BuiltinToolProviderController):
    """
    AI Classification tool provider.

    Connects to a local NeuroSD classification API running in Docker.
    No credentials are required as the API runs on the internal Docker network.
    """

    def _validate_credentials(self, user_id: str, credentials: dict[str, Any]) -> None:
        """
        Validate credentials - no validation needed for this provider.

        The NeuroSD API runs on the internal Docker network without authentication.
        """
        pass
