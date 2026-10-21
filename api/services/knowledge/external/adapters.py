"""External knowledge HTTP and access-policy adapters."""

from collections.abc import Mapping
from typing import Any, cast

from machinery.context import RequestContext
from services.enterprise import rbac_service
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalKnowledgeApiSetting
from services.knowledge.external.service import (
    execute_external_knowledge_retrieval,
    validate_external_knowledge_endpoint,
)
from services.knowledge.resource_scope import DatasetRef
from services.rbac.contracts import RBACResourceType


def sync_external_dataset_creator_access(context: RequestContext, ref: DatasetRef) -> None:
    rbac_service.try_sync_creator_access_policy_member_bindings(
        context.active_workspace_id,
        context.account_id,
        RBACResourceType.DATASET,
        ref.dataset_id,
    )


class ExternalKnowledgeGateway:
    """Validate and call an external provider without owning persistence."""

    def check_settings(self, settings: Mapping[str, Any]) -> None:
        validate_external_knowledge_endpoint(settings)

    def retrieve(self, request: Mapping[str, Any]) -> list[dict[str, Any]]:
        prepared = ExternalKnowledgeApiSetting.model_validate(request)
        return cast(list[dict[str, Any]], execute_external_knowledge_retrieval(prepared))
