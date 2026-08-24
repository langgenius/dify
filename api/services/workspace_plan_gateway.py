"""Deployment-aware plan gateway for workspace queries."""

import logging
from collections.abc import Mapping, Sequence
from typing import override

from configs import dify_config
from enums import CloudPlan, DeploymentEdition
from services.billing_service import BillingService
from services.feature_service import FeatureService
from services.workspace_query_service import WorkspacePlanGateway

logger = logging.getLogger(__name__)


class DeploymentWorkspacePlanGateway(WorkspacePlanGateway):
    """Resolve workspace plans using deployment-specific Billing and Feature sources."""

    @override
    def resolve_many(self, workspace_ids: Sequence[str]) -> Mapping[str, str]:
        ids = tuple(workspace_ids)
        if not ids:
            return {}

        is_enterprise_only = dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE
        if is_enterprise_only:
            return dict.fromkeys(ids, str(CloudPlan.SANDBOX))

        is_saas = dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD
        bulk_plans = BillingService.get_plan_bulk(ids) if is_saas else {}
        if is_saas and not bulk_plans:
            logger.warning("get_plan_bulk returned empty result, falling back to FeatureService")

        resolved: dict[str, str] = {}
        for workspace_id in ids:
            tenant_plan = bulk_plans.get(workspace_id)
            if tenant_plan:
                resolved[workspace_id] = tenant_plan["plan"] or CloudPlan.SANDBOX
                continue

            features = FeatureService.get_features(workspace_id, exclude_vector_space=True)
            resolved[workspace_id] = features.billing.subscription.plan or CloudPlan.SANDBOX

        return resolved
