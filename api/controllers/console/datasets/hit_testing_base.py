import logging
from typing import Any

from flask_restx import marshal
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
from fields.hit_testing_fields import hit_testing_record_fields
from graphon.model_runtime.errors.invoke import InvokeError
from libs.login import current_user
from models.account import Account
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import RetrievalModel
from services.hit_testing_service import HitTestingService

logger = logging.getLogger(__name__)


class HitTestingPayload(BaseModel):
    query: str = Field(max_length=250)
    retrieval_model: RetrievalModel | None = None
    external_retrieval_model: dict[str, Any] | None = None
    attachment_ids: list[str] | None = None


class DatasetsHitTestingBase:
    @staticmethod
    def _extract_hit_testing_query(query: Any) -> str:
        """Return the query string from the service response shape."""
        if isinstance(query, dict):
            content = query.get("content")
            if isinstance(content, str):
                return content

        raise ValueError("Invalid hit testing query response")

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
                if normalized_segment.get("keywords") is None:
                    normalized_segment["keywords"] = []
                normalized_record["segment"] = normalized_segment

            if normalized_record.get("child_chunks") is None:
                normalized_record["child_chunks"] = []

            if normalized_record.get("files") is None:
                normalized_record["files"] = []

            normalized_records.append(normalized_record)

        return normalized_records

    @staticmethod
    def get_and_validate_dataset(dataset_id: str):
        assert isinstance(current_user, Account)
        dataset = DatasetService.get_dataset(dataset_id)
        if dataset is None:
            raise NotFound("Dataset not found.")

        try:
            DatasetService.check_dataset_permission(dataset, current_user)
        except services.errors.account.NoPermissionError as e:
            raise Forbidden(str(e))

        return dataset

    @staticmethod
    def hit_testing_args_check(args: dict[str, Any]):
        HitTestingService.hit_testing_args_check(args)

    @staticmethod
    def parse_args(payload: dict[str, Any]) -> dict[str, Any]:
        """Validate and return hit-testing arguments from an incoming payload."""
        hit_testing_payload = HitTestingPayload.model_validate(payload or {})
        return hit_testing_payload.model_dump(exclude_none=True)

    @staticmethod
    def perform_hit_testing(dataset, args):
        assert isinstance(current_user, Account)
        try:
            response = HitTestingService.retrieve(
                dataset=dataset,
                query=args.get("query"),
                account=current_user,
                retrieval_model=args.get("retrieval_model"),
                external_retrieval_model=args.get("external_retrieval_model"),
                attachment_ids=args.get("attachment_ids"),
                limit=10,
            )
            return {
                "query": DatasetsHitTestingBase._extract_hit_testing_query(response.get("query")),
                "records": DatasetsHitTestingBase._prepare_hit_testing_records(
                    marshal(response.get("records", []), hit_testing_record_fields)
                ),
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
