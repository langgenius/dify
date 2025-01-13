import re
from typing import Any
from urllib.parse import urlparse

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.vanna.tools.vanna import VannaTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class VannaProvider(BuiltinToolProviderController):
    def _get_protocol_and_main_domain(self, url):
        parsed_url = urlparse(url)
        protocol = parsed_url.scheme
        hostname = parsed_url.hostname
        port = f":{parsed_url.port}" if parsed_url.port else ""

        # Check if the hostname is an IP address
        is_ip = re.match(r"^\d{1,3}(\.\d{1,3}){3}$", hostname) is not None

        # Return the full hostname (with port if present) for IP addresses, otherwise return the main domain
        main_domain = f"{hostname}{port}" if is_ip else ".".join(hostname.split(".")[-2:]) + port
        return f"{protocol}://{main_domain}"

    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        base_url = credentials.get("base_url")
        if not base_url:
            base_url = "https://ask.vanna.ai/rpc"
        else:
            base_url = base_url.removesuffix("/")
        credentials["base_url"] = base_url
        try:
            VannaTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "model": "chinook",
                    "db_type": "SQLite",
                    "url": f'{self._get_protocol_and_main_domain(credentials["base_url"])}/Chinook.sqlite',
                    "query": "What are the top 10 customers by sales?",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
