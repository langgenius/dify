"""Wrapper around ZhipuAI embedding models."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Extra, root_validator

from langchain.embeddings.base import Embeddings
from langchain.utils import get_from_dict_or_env

from core.third_party.langchain.llms.zhipuai_llm import ZhipuModelAPI


class ZhipuAIEmbeddings(BaseModel, Embeddings):
    """Wrapper around ZhipuAI embedding models.
    1024 dimensions.
    """

    client: Any  #: :meta private:
    model: str
    """Model name to use."""

    base_url: str = "https://open.bigmodel.cn/api/paas/v3/model-api"
    api_key: Optional[str] = None

    class Config:
        """Configuration for this pydantic object."""

        extra = Extra.forbid

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        """Validate that api key and python package exists in environment."""
        values["api_key"] = get_from_dict_or_env(
            values, "api_key", "ZHIPUAI_API_KEY"
        )
        values['client'] = ZhipuModelAPI(api_key=values['api_key'], base_url=values['base_url'])
        return values

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Call out to ZhipuAI's embedding endpoint.

        Args:
            texts: The list of texts to embed.

        Returns:
            List of embeddings, one for each text.
        """
        embeddings = []
        for text in texts:
            response = self.client.invoke(model=self.model, prompt=text)
            data = response["data"]
            embeddings.append(data.get('embedding'))

        return [list(map(float, e)) for e in embeddings]

    def embed_query(self, text: str) -> List[float]:
        """Call out to ZhipuAI's embedding endpoint.

        Args:
            text: The text to embed.

        Returns:
            Embeddings for the text.
        """
        return self.embed_documents([text])[0]
