from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.aliyun.tools.duguang import DuGuangTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class AliYunProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            DuGuangTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "image_url": "https://private-user-images.githubusercontent.com/13230914/321628871-f9e19af5-61ba-4119-b926-d10c4c06ebab.png?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3MzE1NjYxMTcsIm5iZiI6MTczMTU2NTgxNywicGF0aCI6Ii8xMzIzMDkxNC8zMjE2Mjg4NzEtZjllMTlhZjUtNjFiYS00MTE5LWI5MjYtZDEwYzRjMDZlYmFiLnBuZz9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNDExMTQlMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjQxMTE0VDA2MzAxN1omWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPThlZTZiOTIyOWExMDNjOTEzZThmM2RiZGMyMWQwMzk1YjIxNGQyMTlkMGQyMWQ1ZTg3MWNhOTZhYTA4Y2I0NjAmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.tcf-bx7wXyUAFgOBmnEFK_tnluXS3gHk4LjpeSirohk",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
