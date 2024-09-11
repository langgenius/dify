import requests

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class GithubProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            if "access_tokens" not in credentials or not credentials.get("access_tokens"):
                raise ToolProviderCredentialValidationError("Github API Access Tokens is required.")
            if "api_version" not in credentials or not credentials.get("api_version"):
                api_version = "2022-11-28"
            else:
                api_version = credentials.get("api_version")

            try:
                headers = {
                    "Content-Type": "application/vnd.github+json",
                    "Authorization": f"Bearer {credentials.get('access_tokens')}",
                    "X-GitHub-Api-Version": api_version,
                }

                response = requests.get(
                    url="https://api.github.com/search/users?q={account}".format(account="charli117"), headers=headers
                )
                if response.status_code != 200:
                    raise ToolProviderCredentialValidationError((response.json()).get("message"))
            except Exception as e:
                raise ToolProviderCredentialValidationError("Github API Key and Api Version is invalid. {}".format(e))
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
