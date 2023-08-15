"""Wrapper around Replicate embedding models."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Extra, root_validator

from langchain.embeddings.base import Embeddings
from langchain.utils import get_from_dict_or_env


class ReplicateEmbeddings(BaseModel, Embeddings):
    """Wrapper around Replicate embedding models.

    To use, you should have the ``replicate`` python package installed.
    """

    client: Any  #: :meta private:
    model: str
    """Model name to use."""

    replicate_api_token: Optional[str] = None

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        replicate_api_token = get_from_dict_or_env(
            values, "replicate_api_token", "REPLICATE_API_TOKEN"
        )
        try:
            import replicate as replicate_python

            values["client"] = replicate_python.Client(api_token=replicate_api_token)
        except ImportError:
            raise ImportError(
                "Could not import replicate python package. "
                "Please install it with `pip install replicate`."
            )
        return values

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Call out to Replicate's embedding endpoint.

        Args:
            texts: The list of texts to embed.

        Returns:
            List of embeddings, one for each text.
        """
        # get the model and version
        model_str, version_str = self.model.split(":")
        model = self.client.models.get(model_str)
        version = model.versions.get(version_str)

        # sort through the openapi schema to get the name of the first input
        input_properties = sorted(
            version.openapi_schema["components"]["schemas"]["Input"][
                "properties"
            ].items(),
            key=lambda item: item[1].get("x-order", 0),
        )
        first_input_name = input_properties[0][0]

        embeddings = []
        for text in texts:
            result = self.client.run(self.model, input={first_input_name: text})
            embeddings.append(result[0].get('embedding'))

        return [list(map(float, e)) for e in embeddings]

    def embed_query(self, text: str) -> List[float]:
        """Call out to Replicate's embedding endpoint.

        Args:
            text: The text to embed.

        Returns:
            Embeddings for the text.
        """
        # get the model and version
        model_str, version_str = self.model.split(":")
        model = self.client.models.get(model_str)
        version = model.versions.get(version_str)

        # sort through the openapi schema to get the name of the first input
        input_properties = sorted(
            version.openapi_schema["components"]["schemas"]["Input"][
                "properties"
            ].items(),
            key=lambda item: item[1].get("x-order", 0),
        )
        first_input_name = input_properties[0][0]
        result = self.client.run(self.model, input={first_input_name: text})
        embedding = result[0].get('embedding')

        return list(map(float, embedding))
