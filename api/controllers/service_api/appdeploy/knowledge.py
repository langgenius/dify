"""Knowledge retrieval for AppDeploy runners.

AppDeploy is the enterprise runtime for deployed workflow apps. Its runner
executes knowledge-retrieval nodes outside Dify, so it calls this endpoint with
the ``managed_by="appdeploy"`` access token the enterprise control plane minted
for the deployed revision. Retrieval is the same workflow retrieval as
``/inner/api/knowledge/retrieve``; only authorization differs: the tenant comes
from the token and every requested dataset must be bound to it.

Like the ``/files/appdeploy`` endpoints, it stays off ``inner_api`` because the
runner is not a trusted master-key caller, and it is hidden from the public
Service API document because only AppDeploy runners can call it.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session
from werkzeug.exceptions import Unauthorized

from controllers.common.knowledge_retrieval_errors import KnowledgeRetrievalHttpError, knowledge_retrieval_errors
from controllers.common.resource_access_token_errors import resource_access_token_errors
from controllers.common.session import with_session
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import peek_service_api_bearer_token
from extensions.ext_application_services import application_services
from services.entities.knowledge_retrieval_inner import (
    InnerKnowledgeRetrieveCaller,
    InnerKnowledgeRetrieveMetadataFilteringConfig,
    InnerKnowledgeRetrieveRequest,
    InnerKnowledgeRetrieveRetrievalConfig,
)
from services.knowledge_retrieval_inner_service import InnerKnowledgeRetrievalService


class AppDeployKnowledgeRetrieveCaller(BaseModel):
    """The inner caller context without ``tenant_id``, which the token decides."""

    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(min_length=1)
    app_id: str = Field(min_length=1)
    user_from: Literal["account", "end-user"]
    invoke_from: str = Field(min_length=1)


class AppDeployKnowledgeRetrievePayload(BaseModel):
    """Text-query retrieval; attachment queries are not supported for AppDeploy yet."""

    model_config = ConfigDict(extra="forbid")

    caller: AppDeployKnowledgeRetrieveCaller
    dataset_ids: list[UUID] = Field(min_length=1)
    query: str | None = None
    retrieval: InnerKnowledgeRetrieveRetrievalConfig
    metadata_filtering: InnerKnowledgeRetrieveMetadataFilteringConfig = Field(
        default_factory=InnerKnowledgeRetrieveMetadataFilteringConfig
    )


def _invalid_request(exc: ValidationError) -> KnowledgeRetrievalHttpError:
    return KnowledgeRetrievalHttpError(error_code="invalid_request", description=str(exc), status_code=400)


@service_api_ns.route("/appdeploy/knowledge/retrieve")
@service_api_ns.hide
class AppDeployKnowledgeRetrieveApi(Resource):
    @with_session
    def post(self, session: Session) -> dict[str, object]:
        token = peek_service_api_bearer_token()
        if not token:
            raise Unauthorized("Authorization header must be provided and start with 'Bearer'")
        try:
            payload = AppDeployKnowledgeRetrievePayload.model_validate(service_api_ns.payload or {})
        except ValidationError as exc:
            raise _invalid_request(exc) from exc

        dataset_ids = [str(dataset_id) for dataset_id in payload.dataset_ids]
        with resource_access_token_errors():
            tenant_id = application_services().resource_access_tokens.authorize_appdeploy_knowledge(
                token=token, dataset_ids=dataset_ids
            )
        try:
            request = InnerKnowledgeRetrieveRequest(
                caller=InnerKnowledgeRetrieveCaller(tenant_id=tenant_id, **payload.caller.model_dump()),
                dataset_ids=dataset_ids,
                query=payload.query,
                retrieval=payload.retrieval,
                metadata_filtering=payload.metadata_filtering,
            )
        except ValidationError as exc:
            raise _invalid_request(exc) from exc

        with knowledge_retrieval_errors():
            response = InnerKnowledgeRetrievalService().retrieve(request, session=session)
        return response.model_dump(mode="json", by_alias=True)
