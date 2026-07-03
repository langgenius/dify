from __future__ import annotations

from uuid import UUID

from flask_restx import Resource
from sqlalchemy.orm import Session

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.app.wraps import with_session
from controllers.console.wraps import RBACPermission, RBACResourceScope, rbac_permission_required
from fields.hit_testing_fields import HitTestingResponse
from libs.helper import dump_response
from libs.login import login_required
from models import Account

from .. import console_ns
from ..datasets.hit_testing_base import DatasetsHitTestingBase, HitTestingPayload
from ..wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)

register_schema_models(console_ns, HitTestingPayload)
register_response_schema_models(console_ns, HitTestingResponse)


@console_ns.route("/datasets/<uuid:dataset_id>/hit-testing")
class HitTestingApi(Resource, DatasetsHitTestingBase):
    @console_ns.doc("test_dataset_retrieval")
    @console_ns.doc(description="Test dataset knowledge retrieval")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[HitTestingPayload.__name__])
    @console_ns.response(
        200,
        "Hit testing completed successfully",
        model=console_ns.models[HitTestingResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(400, "Invalid parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_tenant_id
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_PIPELINE_TEST)
    @with_session
    def post(
        self, session: Session, current_user: Account, current_tenant_id: str, dataset_id: UUID
    ) -> dict[str, object]:
        dataset_id_str = str(dataset_id)

        dataset = self.get_and_validate_dataset(dataset_id_str, current_user, current_tenant_id)
        args = self.parse_args(console_ns.payload)
        self.hit_testing_args_check(args)

        return dump_response(
            HitTestingResponse,
            self.perform_hit_testing(session, dataset, args, current_user, current_tenant_id),
        )
