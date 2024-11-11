from typing import Optional

import httpx

from core.model_runtime.entities.rerank_entities import RerankDocument, RerankResult
from core.model_runtime.errors.invoke import InvokeError
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.rerank_model import RerankModel
from core.model_runtime.model_providers.wenxin._common import _CommonWenxin
from core.model_runtime.model_providers.wenxin.wenxin_errors import (
    InternalServerError,
    invoke_error_mapping,
)


class WenxinRerank(_CommonWenxin):
    def rerank(self, model: str, query: str, docs: list[str], top_n: Optional[int] = None):
        access_token = self._get_access_token()
        url = f"{self.api_bases[model]}?access_token={access_token}"

        try:
            response = httpx.post(
                url,
                json={"model": model, "query": query, "documents": docs, "top_n": top_n},
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            raise InternalServerError(str(e))


class WenxinRerankModel(RerankModel):
    """
    Model class for wenxin rerank model.
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

        api_key = credentials["api_key"]
        secret_key = credentials["secret_key"]

        wenxin_rerank: WenxinRerank = WenxinRerank(api_key, secret_key)

        try:
            results = wenxin_rerank.rerank(model, query, docs, top_n)

            rerank_documents = []
            for result in results["results"]:
                index = result["index"]
                if "document" in result:
                    text = result["document"]
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
            raise InternalServerError(str(e))

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
        return invoke_error_mapping()
