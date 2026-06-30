import logging
from typing import Any, cast

from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, InternalServerError, NotFound

import services
from controllers.console.app.error import (
    CompletionRequestError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderQuotaExceededError,
)
from controllers.console.datasets.error import DatasetNotInitializedError
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from extensions.ext_database import db
from graphon.model_runtime.errors.invoke import InvokeError
from libs.login import resolve_account_fallback
from models.account import Account
from models.dataset import Dataset
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import ExternalRetrievalModel, RetrievalModel
from services.hit_testing_service import HitTestingService

logger = logging.getLogger(__name__)


class HitTestingPayload(BaseModel):
    query: str = Field(description="Search query text.", max_length=250)
    retrieval_model: RetrievalModel | None = Field(
        default=None,
        description="Retrieval model configuration. Controls how chunks are searched and ranked.",
    )
    external_retrieval_model: ExternalRetrievalModel = Field(
        default=None,
        description="Retrieval settings for external knowledge bases.",
    )
    attachment_ids: list[str] | None = Field(
        default=None,
        description="List of attachment IDs to include in the retrieval context.",
    )


class DatasetsHitTestingBase:
    @staticmethod
    def _prepare_hit_testing_records(records: Any) -> list[dict[str, Any]]:
        """Ensure collection fields match the API schema before response validation."""
        if not isinstance(records, list):
            raise ValueError("Invalid hit testing records response")

        normalized_records: list[dict[str, Any]] = []
        for record in records:
            if not isinstance(record, dict):
                raise ValueError("Invalid hit testing record response")

            normalized_record = dict(record)
            segment = normalized_record.get("segment")
            if isinstance(segment, dict):
                normalized_segment = dict(segment)
                normalized_segment.setdefault("sign_content", None)
                if normalized_segment.get("keywords") is None:
                    normalized_segment["keywords"] = []
                normalized_record["segment"] = normalized_segment

            if normalized_record.get("child_chunks") is None:
                normalized_record["child_chunks"] = []

            if normalized_record.get("files") is None:
                normalized_record["files"] = []

            normalized_record.setdefault("tsne_position", None)
            normalized_record.setdefault("summary", None)

            normalized_records.append(normalized_record)

        return normalized_records

    @staticmethod
    def get_and_validate_dataset(
        dataset_id: str, current_user: Account | None = None, current_tenant_id: str | None = None
    ) -> Dataset:
        current_user, _ = resolve_account_fallback(current_user, current_tenant_id)
        dataset = DatasetService.get_dataset(dataset_id)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user, db.session)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        return dataset

    @staticmethod
    def hit_testing_args_check(args: dict[str, Any]) -> None:
        HitTestingService.hit_testing_args_check(args)

    @staticmethod
    def parse_args(payload: dict[str, Any] | None) -> dict[str, Any]:
        """Validate and return hit-testing arguments from an incoming payload."""
        hit_testing_payload = HitTestingPayload.model_validate(payload or {})
        return hit_testing_payload.model_dump(exclude_none=True)

    @staticmethod
    def perform_hit_testing(
        dataset: Dataset,
        args: dict[str, Any],
        current_user: Account | None = None,
        current_tenant_id: str | None = None,
    ) -> dict[str, Any]:
        try:
            current_user, _ = resolve_account_fallback(current_user, current_tenant_id)
            response = HitTestingService.retrieve(
                session=db.session,
                dataset=dataset,
                query=cast(str, args.get("query")),
                account=current_user,
                retrieval_model=args.get("retrieval_model"),
                external_retrieval_model=cast(dict[str, Any], args.get("external_retrieval_model")),
                attachment_ids=args.get("attachment_ids"),
                limit=10,
                session=db.session,
            )
            query = response.get("query")
            if not isinstance(query, dict) or not isinstance(query.get("content"), str):
                raise ValueError("Invalid hit testing query response")

            return {
                "query": {"content": query["content"]},
                "records": DatasetsHitTestingBase._prepare_hit_testing_records(response.get("records", [])),
            }
        except services.errors.index.IndexNotInitializedError:
            raise DatasetNotInitializedError()
        except ProviderTokenNotInitError as ex:
            raise ProviderNotInitializeError(ex.description)
        except QuotaExceededError:
            raise ProviderQuotaExceededError()
        except ModelCurrentlyNotSupportError:
            raise ProviderModelCurrentlyNotSupportError()
        except LLMBadRequestError:
            raise ProviderNotInitializeError(
                "No Embedding Model or Reranking Model available. Please configure a valid provider "
                "in the Settings -> Model Provider."
            )
        except InvokeError as e:
            raise CompletionRequestError(e.description)
        except ValueError as e:
            raise ValueError(str(e))
        except Exception as e:
            logger.exception("Hit testing failed.")
            raise InternalServerError(str(e))
