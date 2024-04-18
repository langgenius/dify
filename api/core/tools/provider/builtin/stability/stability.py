from typing import Any

from core.tools.provider.builtin.stability.tools.base import BaseStabilityAuthorization
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class StabilityToolProvider(BuiltinToolProviderController, BaseStabilityAuthorization):
    """
    This class is responsible for providing the stability tool.
    """
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        """
        This method is responsible for validating the credentials.
        """
        self.sd_validate_credentials(credentials)