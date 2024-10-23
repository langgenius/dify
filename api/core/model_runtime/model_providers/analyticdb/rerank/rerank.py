from typing import Optional

from alibabacloud_gpdb20160503 import models as gpdb_20160503_models
from alibabacloud_gpdb20160503.client import Client
from alibabacloud_tea_openapi import models as open_api_models

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


class AnalyticdbRerankModel(RerankModel):
    """
    Model class for Analyticdb rerank model.
    """

    def _build_client(self, credentials: dict) -> Client:
        config = {
            "access_key_id": credentials["access_key_id"],
            "access_key_secret": credentials["access_key_secret"],
            "region_id": credentials["region_id"],
            "read_timeout": 60000,
            "user_agent": "dify",
        }
        config = open_api_models.Config(**config)
        return Client(config)

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
                query="What is the ADBPG?",
                docs=[
                    "Example doc 1",
                    "Example doc 2",
                    "Example doc 3",
                ],
            )
        except Exception as ex:
            raise CredentialsValidateFailedError(str(ex))

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

        client = self._build_client(credentials)
        request = gpdb_20160503_models.RerankRequest(
            dbinstance_id=credentials["instance_id"],
            documents=docs,
            query=query,
            model=model,
            region_id=credentials["region_id"],
            top_k=top_n or 3,
        )
        try:
            response = client.rerank(request)
        except Exception as e:
            raise e
        rerank_documents = []
        if not response.body.results:
            raise CredentialsValidateFailedError(
                """
                Instance ID does not exist or RAM does not have rerank permission. 
                Visit https://ram.console.aliyun.com/
                to add `gpdb:Rerank` permission.
                """
            )
        for result in response.body.results.results:
            if score_threshold and result["RelevanceScore"] < score_threshold:
                continue
            rerank_documents.append(
                RerankDocument(
                    index=result.index,
                    score=result.relevance_score,
                    text=docs[result.index],
                )
            )

        return RerankResult(model=model, docs=rerank_documents)

    @property
    def _invoke_error_mapping(self) -> dict[type[InvokeError], list[type[Exception]]]:
        return {
            InvokeConnectionError: [InvokeConnectionError],
            InvokeServerUnavailableError: [InvokeServerUnavailableError],
            InvokeRateLimitError: [InvokeRateLimitError],
            InvokeAuthorizationError: [InvokeAuthorizationError],
            InvokeBadRequestError: [InvokeBadRequestError],
        }
