from huggingface_hub.utils import HfHubHTTPError

from core.model_runtime.errors.invoke import InvokeBadRequestError, InvokeError


class _CommonHuggingfaceHub:

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeBadRequestError: [
                HfHubHTTPError
            ]
        }
