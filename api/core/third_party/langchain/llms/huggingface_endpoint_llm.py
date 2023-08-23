from typing import Dict

from langchain.llms import HuggingFaceEndpoint
from pydantic import Extra, root_validator

from langchain.utils import get_from_dict_or_env


class HuggingFaceEndpointLLM(HuggingFaceEndpoint):
    """HuggingFace Endpoint models.

    To use, you should have the ``huggingface_hub`` python package installed, and the
    environment variable ``HUGGINGFACEHUB_API_TOKEN`` set with your API token, or pass
    it as a named parameter to the constructor.

    Only supports `text-generation` and `text2text-generation` for now.

    Example:
        .. code-block:: python

            from langchain.llms import HuggingFaceEndpoint
            endpoint_url = (
                "https://abcdefghijklmnop.us-east-1.aws.endpoints.huggingface.cloud"
            )
            hf = HuggingFaceEndpoint(
                endpoint_url=endpoint_url,
                huggingfacehub_api_token="my-api-key"
            )
    """

    @root_validator(allow_reuse=True)
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        huggingfacehub_api_token = get_from_dict_or_env(
            values, "huggingfacehub_api_token", "HUGGINGFACEHUB_API_TOKEN"
        )

        values["huggingfacehub_api_token"] = huggingfacehub_api_token
        return values
