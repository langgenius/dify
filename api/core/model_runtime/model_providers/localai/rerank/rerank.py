from json import dumps
from typing import Optional

import httpx
from requests import post
from yarl import URL

from core.model_runtime.entities.rerank_entities import RerankDocument, RerankResult
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.rerank_model import RerankModel


class LocalaiRerankModel(RerankModel):
    """
    LocalAI rerank model API is compatible with Jina rerank model API. So just copy the JinaRerankModel class code here.
    """

    def _invoke(self, model: str, credentials: dict,
                query: str, docs: list[str], score_threshold: Optional[float] = None, top_n: Optional[int] = None,
                user: Optional[str] = None) -> RerankResult:
        """
        Invoke rerank model

        :param model: model name
        :param credentials: model credentials
        :param query: search query
        :param docs: docs for reranking
        :param score_threshold: score threshold
        :param top_n: top n documents to return
        :param user: unique user id
        :return: rerank result
        """
        if len(docs) == 0:
            return RerankResult(model=model, docs=[])

        server_url = credentials['server_url']
        model_name = model
        
        if not server_url:
            raise CredentialsValidateFailedError('server_url is required')
        if not model_name:
            raise CredentialsValidateFailedError('model_name is required')
        
        url = server_url
        headers = {
            'Authorization': f"Bearer {credentials.get('api_key')}",
            'Content-Type': 'application/json'
        }

        data = {
            "model": model_name,
            "query": query,
            "documents": docs,
            "top_n": top_n
        }

        try:
            response = post(str(URL(url) / 'rerank'), headers=headers, data=dumps(data), timeout=10)
            response.raise_for_status() 
            results = response.json()

            rerank_documents = []
            for result in results['results']:  
                rerank_document = RerankDocument(
                    index=result['index'],
                    text=result['document']['text'],
                    score=result['relevance_score'],
                )
                if score_threshold is None or result['relevance_score'] >= score_threshold:
                    rerank_documents.append(rerank_document)

            return RerankResult(model=model, docs=rerank_documents)
        except httpx.HTTPStatusError as e:
            raise InvokeServerUnavailableError(str(e))  

    def validate_credentials(self, model: str, credentials: dict) -> None:
        """
        Validate model credentials

        :param model: model name
        :param credentials: model credentials
        :return:
        """
        try:
            
            self._invoke(
                model=model,
                credentials=credentials,
                query="What is the capital of the United States?",
                docs=[
                    "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
                    "Census, Carson City had a population of 55,274.",
                    "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean that "
                    "are a political division controlled by the United States. Its capital is Saipan.",
                ],
                score_threshold=0.8
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        """
        return {
            InvokeConnectionError: [httpx.ConnectError],
            InvokeServerUnavailableError: [httpx.RemoteProtocolError],
            InvokeRateLimitError: [], 
            InvokeAuthorizationError: [httpx.HTTPStatusError],  
            InvokeBadRequestError: [httpx.RequestError]
        }
