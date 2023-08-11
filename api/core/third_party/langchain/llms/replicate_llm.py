from typing import Dict, Optional, List, Any

from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.llms import Replicate
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

        prediction = client.predictions.create(
            version=version, input={**inputs, **kwargs}
        )
        current_completion: str = ""
        stop_condition_reached = False
        for output in prediction.output_iterator():
            current_completion += output

            # test for stop conditions, if specified
            if stop:
                for s in stop:
                    if s in current_completion:
                        prediction.cancel()
                        stop_index = current_completion.find(s)
                        current_completion = current_completion[:stop_index]
                        stop_condition_reached = True
                        break

            if stop_condition_reached:
                break

            if self.streaming and run_manager:
                run_manager.on_llm_new_token(output)
        return current_completion
