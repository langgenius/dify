import time
from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.cloudflarekv.tools.cfkv_put import CloudflareKVPut
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController

class CloudflareKVProviderController(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            CloudflareKVPut().fork_tool_runtime(runtime={'credentials': credentials}).invoke(
                user_id='',
                tool_parameters={
                    'key': 'dify_test_key',
                    'value': f'Dify test value - {time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())}',
                    'namespace_id': credentials.get('namespace_id', ''),  # Assuming namespace_id is part of the credentials
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))