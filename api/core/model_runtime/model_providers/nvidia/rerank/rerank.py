from math import exp
from typing import Optional

import requests

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


class NvidiaRerankModel(RerankModel):
    """
    Model class for NVIDIA rerank model.
    """

    def _sigmoid(self, logit: float) -> float:
        return 1 / (1 + exp(-logit))

    def _invoke(
        self,
        model: str,
        credentials: dict,
        query: str,
        docs: list[str],
        score_threshold: Optional[float] = None,
        top_n: Optional[int] = None,
        user: Optional[str] = None,
    ) -> RerankResult:
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

        try:
            invoke_url = "https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking"

            headers = {
                "Authorization": f"Bearer {credentials.get('api_key')}",
                "Accept": "application/json",
            }
            payload = {
                "model": model,
                "query": {"text": query},
                "passages": [{"text": doc} for doc in docs],
            }
            session = requests.Session()
            response = session.post(invoke_url, headers=headers, json=payload)
            response.raise_for_status()
            results = response.json()

            rerank_documents = []
            for result in results["rankings"]:
                index = result["index"]
                logit = result["logit"]
                rerank_document = RerankDocument(
                    index=index,
                    text=docs[index],
                    score=self._sigmoid(logit),
                )

                rerank_documents.append(rerank_document)
            if rerank_documents:
                rerank_documents = sorted(rerank_documents, key=lambda x: x.score, reverse=True)
                if top_n:
                    rerank_documents = rerank_documents[:top_n]
            return RerankResult(model=model, docs=rerank_documents)
        except requests.HTTPError as e:
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
                query="What is the GPU memory bandwidth of H100 SXM?",
                docs=[
                    "Example doc 1",
                    "Example doc 2",
                    "Example doc 3",
                ],
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        """
        Map model invoke error to unified error
        """
        return {
            InvokeConnectionError: [requests.ConnectionError],
            InvokeServerUnavailableError: [requests.HTTPError],
            InvokeRateLimitError: [],
            InvokeAuthorizationError: [requests.HTTPError],
            InvokeBadRequestError: [requests.RequestException],
        }
