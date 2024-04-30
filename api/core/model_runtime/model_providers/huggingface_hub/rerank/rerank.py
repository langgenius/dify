from typing import Optional

import requests
from BCEmbedding import RerankerModel

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


class HuggingFaceRerankModel(RerankModel):
    """
    Model class for Huggingface rerank model.
    """
    def _invoke(self, model: str, credentials: dict,
                query: str, docs: list[str], score_threshold: Optional[float] = None, top_n: Optional[int] = None,
                user: Optional[str] = None) -> RerankResult:
        rerank_model = RerankerModel(model_name_or_path=model)
        rerank_results = rerank_model.rerank(query, docs)
        
        rerank_documents = []
        for id, idx in enumerate(rerank_results['rerank_ids']):
            # format document
            rerank_document = RerankDocument(
                index=idx, # 这个对应原文档中的索引吧？
                text=rerank_results['rerank_passages'][id],
                score=rerank_results['rerank_scores'][id],
            )

            # score threshold check
            if score_threshold is not None:
                if rerank_results['rerank_scores'][id] >= score_threshold:
                    rerank_documents.append(rerank_document)
            else:
                rerank_documents.append(rerank_document)
        
        return RerankResult(
            model=model,
            docs=rerank_documents
        )
        
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
            InvokeBadRequestError: [requests.RequestException]
        }
        
    def get_customizable_model_schema(self, model: str, credentials: dict) -> Optional[AIModelEntity]:
        entity = AIModelEntity(
            model=model,
            label=I18nObject(
                en_US=model
            ),
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_type=ModelType.RERANK,
            model_properties={
                'context_size': 10000,
                'max_chunks': 1
            }
        )
        return entity