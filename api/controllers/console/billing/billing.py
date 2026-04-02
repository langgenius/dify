import base64
import json
from datetime import UTC, datetime, timedelta
from typing import Literal

from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field
from werkzeug.exceptions import BadRequest

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, only_edition_cloud, setup_required
from enums.cloud_plan import CloudPlan
from extensions.ext_redis import redis_client
from libs.login import current_account_with_tenant, login_required
from services.billing_service import BillingService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class SubscriptionQuery(BaseModel):
    plan: Literal[CloudPlan.PROFESSIONAL, CloudPlan.TEAM] = Field(..., description="Subscription plan")
    interval: Literal["month", "year"] = Field(..., description="Billing interval")


class PartnerTenantsPayload(BaseModel):
    click_id: str = Field(..., description="Click Id from partner referral link")


for model in (SubscriptionQuery, PartnerTenantsPayload):
    console_ns.schema_model(model.__name__, model.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


@console_ns.route("/billing/subscription")
class Subscription(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        args = SubscriptionQuery.model_validate(request.args.to_dict(flat=True))
        BillingService.is_tenant_owner_or_admin(current_user)
        return BillingService.get_subscription(args.plan, args.interval, current_user.email, current_tenant_id)


@console_ns.route("/billing/invoices")
class Invoices(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def get(self):
        current_user, current_tenant_id = current_account_with_tenant()
        BillingService.is_tenant_owner_or_admin(current_user)
        return BillingService.get_invoices(current_user.email, current_tenant_id)


@console_ns.route("/billing/partners/<string:partner_key>/tenants")
class PartnerTenants(Resource):
    @console_ns.doc("sync_partner_tenants_bindings")
    @console_ns.doc(description="Sync partner tenants bindings")
    @console_ns.doc(params={"partner_key": "Partner key"})
    @console_ns.expect(
        console_ns.model(
            "SyncPartnerTenantsBindingsRequest",
            {"click_id": fields.String(required=True, description="Click Id from partner referral link")},
        )
    )
    @console_ns.response(200, "Tenants synced to partner successfully")
    @console_ns.response(400, "Invalid partner information")
    @setup_required
    @login_required
    @account_initialization_required
    @only_edition_cloud
    def put(self, partner_key: str):
        current_user, _ = current_account_with_tenant()

        try:
            args = PartnerTenantsPayload.model_validate(console_ns.payload or {})
            click_id = args.click_id
            decoded_partner_key = base64.b64decode(partner_key).decode("utf-8")
        except Exception:
            raise BadRequest("Invalid partner_key")

        if not click_id or not decoded_partner_key or not current_user.id:
            raise BadRequest("Invalid partner information")

        return BillingService.sync_partner_tenants_bindings(current_user.id, decoded_partner_key, click_id)


_DEBUG_KEY = "billing:debug"
_DEBUG_TTL = timedelta(days=7)


class DebugDataPayload(BaseModel):
    type: str = Field(..., min_length=1, description="Data type key")
    data: str = Field(..., min_length=1, description="Data value to append")


@console_ns.route("/billing/debug/data")
class DebugData(Resource):
    def post(self):
        body = DebugDataPayload.model_validate(request.get_json(force=True))
        item = json.dumps({
            "type": body.type,
            "data": body.data,
            "createTime": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
        redis_client.lpush(_DEBUG_KEY, item)
        redis_client.expire(_DEBUG_KEY, _DEBUG_TTL)
        return {"result": "ok"}, 201

    def get(self):
        recent = request.args.get("recent", 10, type=int)
        items = redis_client.lrange(_DEBUG_KEY, 0, recent - 1)
        return {
            "data": [
                json.loads(item.decode("utf-8") if isinstance(item, bytes) else item) for item in items
            ]
        }
