from typing import Optional

import httpx

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelPropertyKey, ModelType
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


class JinaRerankModel(RerankModel):
    """
    Model class for Jina rerank model.
    """

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

        base_url = credentials.get("base_url", "https://api.jina.ai/v1")
        base_url = base_url.removesuffix("/")

        try:
            response = httpx.post(
                base_url + "/rerank",
                json={"model": model, "query": query, "documents": docs, "top_n": top_n},
                headers={"Authorization": f"Bearer {credentials.get('api_key')}"},
            )
            response.raise_for_status()
            results = response.json()

            rerank_documents = []
            for result in results["results"]:
                index = result["index"]
                if "document" in result:
                    text = result["document"]["text"]
                else:
                    # llama.cpp rerank maynot return original documents
                    text = docs[index]

                rerank_document = RerankDocument(
                    index=index,
                    text=text,
                    score=result["relevance_score"],
                )

                if score_threshold is None or result["relevance_score"] >= score_threshold:
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
                score_threshold=0.8,
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
            InvokeBadRequestError: [httpx.RequestError],
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> AIModelEntity:
        """
        generate custom model entities from credentials
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            model_type=ModelType.RERANK,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: int(credentials.get("context_size"))},
        )

        return entity
