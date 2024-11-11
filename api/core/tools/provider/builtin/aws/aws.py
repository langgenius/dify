from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.aws.tools.sagemaker_text_rerank import SageMakerReRankTool
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class SageMakerProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict) -> None:
        try:
            SageMakerReRankTool().fork_tool_runtime(
                runtime={
                    "credentials": credentials,
                }
            ).invoke(
                user_id="",
                tool_parameters={
                    "sagemaker_endpoint": "",
                    "query": "misaka mikoto",
                    "candidate_texts": "hello$$$hello world",
                    "topk": 5,
                    "aws_region": "",
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
