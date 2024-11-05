
from typing import Any
from urllib.parse import urlparse
import re

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.vanna.tools.vanna import VannaTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class VannaProvider(BuiltinToolProviderController):

    def get_protocol_and_main_domain(url):
        parsed_url = urlparse(url)
        protocol = parsed_url.scheme
        hostname = parsed_url.hostname

        ip_pattern = r"^\d{1,3}(\.\d{1,3}){3}$"
        if re.match(ip_pattern, hostname):
            return f"{protocol}://{hostname}"

        domain_parts = hostname.split('.')
        main_domain = '.'.join(domain_parts[-2:])

        return f"{protocol}://{main_domain}"

    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        base_url = credentials.get("base_url", "").removesuffix("/")
        if not base_url:
            base_url = "https://ask.vanna.ai/rpc"
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
                    "url": f"{self.get_protocol_and_main_domain(credentials["base_url"])}/Chinook.sqlite",
                    "query": "What are the top 10 customers by sales?",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))