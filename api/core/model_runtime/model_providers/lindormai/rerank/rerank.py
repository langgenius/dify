import logging
from collections.abc import Mapping
from typing import Optional

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from core.model_runtime.entities.rerank_entities import RerankDocument, RerankResult
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.model_runtime.model_providers.__base.rerank_model import RerankModel
from core.model_runtime.model_providers.lindormai._common import _check_credentials_fields, _CommonLindormAI

logger = logging.getLogger(__name__)


class LindormAIRerankModel(_CommonLindormAI, RerankModel):
    def validate_credentials(self, model: str, credentials: Mapping) -> None:
        try:
            _check_credentials_fields(credentials)
            super()._check_model_status(model, credentials)
            self._invoke(
                model=model,
                credentials=dict(credentials),
                query="What is the capital of the United States?",
                docs=[
                    "Carson City is the capital city of the American state of Nevada. At the 2010 United States "
                    "Census, Carson City had a population of 55,274.",
                    "The Commonwealth of the Northern Mariana Islands is a group of islands in the Pacific Ocean that "
                    "are a political division controlled by the United States. Its capital is Saipan.",
                ],
                score_threshold=0.1,
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
        try:
            if len(docs) == 0:
                return RerankResult(model=model, docs=[])
            _check_credentials_fields(credentials)
            if top_n is None:
                top_n = -1
            results = super()._infer_model(
                model=model,
                credentials=credentials,
                input_data={"query": query, "chunks": docs},
                params={"topK": top_n},
            )
            rerank_documents = []
            for res in results:
                if res["score"] >= score_threshold:
                    rerank_document = RerankDocument(index=res["index"], text=res["chunk"], score=res["score"])
                    rerank_documents.append(rerank_document)
            rerank_documents.sort(key=lambda x: x.score, reverse=True)
            return RerankResult(model=model, docs=rerank_documents)
        except Exception as e:
            logger.exception(f"Failed to invoke rerank model, model: {model}")
            raise

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
