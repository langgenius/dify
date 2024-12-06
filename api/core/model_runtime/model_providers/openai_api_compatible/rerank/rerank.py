from json import dumps
from typing import Optional

import httpx
from requests import post
from yarl import URL

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
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


class OAICompatRerankModel(RerankModel):
    """
    rerank model API is compatible with Jina rerank model API. So copy the JinaRerankModel class code here.
    we need enhance for llama.cpp , which return raw score, not normalize score 0~1.  It seems Dify need it
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

        server_url = credentials["endpoint_url"]
        model_name = model

        if not server_url:
            raise CredentialsValidateFailedError("server_url is required")
        if not model_name:
            raise CredentialsValidateFailedError("model_name is required")

        url = server_url
        headers = {"Authorization": f"Bearer {credentials.get('api_key')}", "Content-Type": "application/json"}

        # TODO: Do we need truncate docs to avoid llama.cpp return error?

        data = {"model": model_name, "query": query, "documents": docs, "top_n": top_n, "return_documents": True}

        try:
            response = post(str(URL(url) / "rerank"), headers=headers, data=dumps(data), timeout=60)
            response.raise_for_status()
            results = response.json()

            rerank_documents = []
            scores = [result["relevance_score"] for result in results["results"]]

            # Min-Max Normalization: Normalize scores to 0 ~ 1.0 range
            min_score = min(scores)
            max_score = max(scores)
            score_range = max_score - min_score if max_score != min_score else 1.0  # Avoid division by zero

            for result in results["results"]:
                index = result["index"]

                # Retrieve document text (fallback if llama.cpp rerank doesn't return it)
                text = docs[index]
                document = result.get("document", {})
                if document:
                    if isinstance(document, dict):
                        text = document.get("text", docs[index])
                    elif isinstance(document, str):
                        text = document

                # Normalize the score
                normalized_score = (result["relevance_score"] - min_score) / score_range

                # Create RerankDocument object with normalized score
                rerank_document = RerankDocument(
                    index=index,
                    text=text,
                    score=normalized_score,
                )

                # Apply threshold (if defined)
                if score_threshold is None or normalized_score >= score_threshold:
                    rerank_documents.append(rerank_document)

            # Sort rerank_documents by normalized score in descending order
            rerank_documents.sort(key=lambda doc: doc.score, reverse=True)

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
            model_properties={},
        )

        return entity
