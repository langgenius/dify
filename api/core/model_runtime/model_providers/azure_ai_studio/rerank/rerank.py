import json
import logging
import os
import ssl
import urllib.request
from typing import Optional

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

logger = logging.getLogger(__name__)


class AzureRerankModel(RerankModel):
    """
    Model class for Azure AI Studio rerank model.
    """

    def _allow_self_signed_https(self, allowed):
        # bypass the server certificate verification on client side
        if allowed and not os.environ.get("PYTHONHTTPSVERIFY", "") and getattr(ssl, "_create_unverified_context", None):
            ssl._create_default_https_context = ssl._create_unverified_context

    def _azure_rerank(self, query_input: str, docs: list[str], endpoint: str, api_key: str):
        #   self._allow_self_signed_https(True)  # Enable if using self-signed certificate

        data = {"inputs": query_input, "docs": docs}

        body = json.dumps(data).encode("utf-8")
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}

        req = urllib.request.Request(endpoint, body, headers)

        try:
            with urllib.request.urlopen(req) as response:
                result = response.read()
                return json.loads(result)
        except urllib.error.HTTPError as error:
            logger.error(f"The request failed with status code: {error.code}")
            logger.error(error.info())
            logger.error(error.read().decode("utf8", "ignore"))
            raise

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
        :param top_n: top n
        :param user: unique user id
        :return: rerank result
        """
        try:
            if len(docs) == 0:
                return RerankResult(model=model, docs=[])

            endpoint = credentials.get("endpoint")
            api_key = credentials.get("jwt_token")

            if not endpoint or not api_key:
                raise ValueError("Azure endpoint and API key must be provided in credentials")

            result = self._azure_rerank(query, docs, endpoint, api_key)
            logger.info(f"Azure rerank result: {result}")

            rerank_documents = []
            for idx, (doc, score_dict) in enumerate(zip(docs, result)):
                score = score_dict["score"]
                rerank_document = RerankDocument(index=idx, text=doc, score=score)

                if score_threshold is None or score >= score_threshold:
                    rerank_documents.append(rerank_document)

            rerank_documents.sort(key=lambda x: x.score, reverse=True)

            if top_n:
                rerank_documents = rerank_documents[:top_n]

            return RerankResult(model=model, docs=rerank_documents)

        except Exception as e:
            logger.exception(f"Exception in Azure rerank: {e}")
            raise

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
        The key is the error type thrown to the caller
        The value is the error type thrown by the model,
        which needs to be converted into a unified error type for the caller.

        :return: Invoke error mapping
        """
        return {
            InvokeConnectionError: [urllib.error.URLError],
            InvokeServerUnavailableError: [urllib.error.HTTPError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [InvokeBadRequestError, KeyError, ValueError, json.JSONDecodeError],
        }

    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        """
        used to define customizable model schema
        """
        entity = AIModelEntity(
            model=model,
            label=I18nObject(en_US=model),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.RERANK,
            model_properties={},
            parameter_rules=[],
        )

        return entity
