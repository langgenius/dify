from typing import Any, Dict, List, Optional, Union
import json

from pydantic import BaseModel, Extra, root_validator

from langchain.embeddings.base import Embeddings
from langchain.utils import get_from_dict_or_env
from huggingface_hub import InferenceClient

HOSTED_INFERENCE_API = 'hosted_inference_api'
INFERENCE_ENDPOINTS = 'inference_endpoints'


class HuggingfaceHubEmbeddings(BaseModel, Embeddings):
    client: Any
    model: str

    task_type: Optional[str] = None
    huggingfacehub_api_type: Optional[str] = None
    huggingfacehub_api_token: Optional[str] = None
    huggingfacehub_endpoint_url: Optional[str] = None

    class Config:
        extra = Extra.forbid

    @root_validator()
    def validate_environment(cls, values: Dict) -> Dict:
        values['huggingfacehub_api_token'] = get_from_dict_or_env(
            values, "huggingfacehub_api_token", "HUGGINGFACEHUB_API_TOKEN"
        )

        values['client'] = InferenceClient(values['huggingfacehub_api_token'])

        return values

    def embeddings(self, inputs: Union[str, List[str]]) -> str:
        model = ''

        if self.huggingfacehub_api_type == HOSTED_INFERENCE_API:
            model = self.model
        else:
            model = self.huggingfacehub_endpoint_url

        output = self.client.post(
            json={
                "inputs": inputs,
                "options": {
                    "wait_for_model": False
                }
            }, model=model)
        
        return json.loads(output.decode())

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self.embeddings(texts)

    def embed_query(self, text: str) -> List[float]:
        return self.embeddings(text)
