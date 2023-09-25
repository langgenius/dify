from typing import Dict, Optional, List, Any

from huggingface_hub import HfApi, InferenceApi
from langchain import HuggingFaceHub
from langchain.callbacks.manager import CallbackManagerForLLMRun
from langchain.llms.huggingface_hub import VALID_TASKS
from pydantic import root_validator

from langchain.utils import get_from_dict_or_env


class HuggingFaceHubLLM(HuggingFaceHub):
    """HuggingFaceHub  models.

    To use, you should have the ``huggingface_hub`` python package installed, and the
    environment variable ``HUGGINGFACEHUB_API_TOKEN`` set with your API token, or pass
    it as a named parameter to the constructor.

    Only supports `text-generation`, `text2text-generation` for now.

    Example:
        .. code-block:: python

            from langchain.llms import HuggingFaceHub
            hf = HuggingFaceHub(repo_id="gpt2", huggingfacehub_api_token="my-api-key")
    """

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        huggingfacehub_api_token = get_from_dict_or_env(
            values, "huggingfacehub_api_token", "HUGGINGFACEHUB_API_TOKEN"
        )
        client = InferenceApi(
            repo_id=values["repo_id"],
            token=huggingfacehub_api_token,
            task=values.get("task"),
        )
        client.options = {"wait_for_model": False, "use_gpu": False}
        values["client"] = client
        return values

    def _call(
            self,
            prompt: str,
            stop: Optional[List[str]] = None,
            run_manager: Optional[CallbackManagerForLLMRun] = None,
            **kwargs: Any,
    ) -> str:
        hfapi = HfApi(token=self.huggingfacehub_api_token)
        model_info = hfapi.model_info(repo_id=self.repo_id)
        if not model_info:
            raise ValueError(f"Model {self.repo_id} not found.")

        if 'inference' in model_info.cardData and not model_info.cardData['inference']:
            raise ValueError(f"Inference API has been turned off for this model {self.repo_id}.")

        if model_info.pipeline_tag not in VALID_TASKS:
            raise ValueError(f"Model {self.repo_id} is not a valid task, "
                             f"must be one of {VALID_TASKS}.")

        return super()._call(prompt, stop, run_manager, **kwargs)
