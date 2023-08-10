from typing import Dict, Optional, List, Any

from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.llms import Replicate
from langchain.llms.utils import enforce_stop_tokens
from langchain.utils import get_from_dict_or_env
from pydantic import root_validator


class EnhanceReplicate(Replicate):
    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        replicate_api_token = get_from_dict_or_env(
            values, "replicate_api_token", "REPLICATE_API_TOKEN"
        )
        values["replicate_api_token"] = replicate_api_token
        return values

    def _call(
        self,
        prompt: str,
        stop: Optional[List[str]] = None,
        run_manager: Optional[CallbackManagerForLLMRun] = None,
        **kwargs: Any,
    ) -> str:
        """Call to replicate endpoint."""
        try:
            import replicate as replicate_python
        except ImportError:
            raise ImportError(
                "Could not import replicate python package. "
                "Please install it with `pip install replicate`."
            )

        client = replicate_python.Client(api_token=self.replicate_api_token)

        # get the model and version
        model_str, version_str = self.model.split(":")
        model = client.models.get(model_str)
        version = model.versions.get(version_str)

        # sort through the openapi schema to get the name of the first input
        input_properties = sorted(
            version.openapi_schema["components"]["schemas"]["Input"][
                "properties"
            ].items(),
            key=lambda item: item[1].get("x-order", 0),
        )
        first_input_name = input_properties[0][0]

        inputs = {first_input_name: prompt, **self.input}
        iterator = client.run(self.model, input={**inputs, **kwargs})

        text = "".join([output for output in iterator])

        if stop is not None:
            text = enforce_stop_tokens(text, stop)

        return text
