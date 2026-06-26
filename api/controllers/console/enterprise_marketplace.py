from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    platform_admin_required,
    setup_required,
)
from libs.login import current_account_with_tenant, login_required
from models import App
from services.enterprise_marketplace_service import (
    EnterpriseMarketplaceAssetStatus,
    EnterpriseMarketplaceReviewPayload,
    EnterpriseMarketplaceService,
    EnterpriseMarketplaceSubmitPayload,
)

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class EnterpriseMarketplaceListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=24, ge=1, le=200)
    keyword: str | None = None
    category: str | None = None


class PlatformAdminEnterpriseMarketplaceListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=50, ge=1, le=200)
    keyword: str | None = None
    status: EnterpriseMarketplaceAssetStatus | None = None


def reg(cls: type[BaseModel]):
    console_ns.schema_model(cls.__name__, cls.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


for model in (
    EnterpriseMarketplaceListQuery,
    PlatformAdminEnterpriseMarketplaceListQuery,
    EnterpriseMarketplaceSubmitPayload,
    EnterpriseMarketplaceReviewPayload,
):
    reg(model)


@console_ns.route("/apps/<uuid:app_id>/enterprise-marketplace/submissions")
class EnterpriseMarketplaceSubmissionApi(Resource):
    @console_ns.expect(console_ns.models[EnterpriseMarketplaceSubmitPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_app_model
    def post(self, app_model: App):
        payload = EnterpriseMarketplaceSubmitPayload.model_validate(console_ns.payload or {})
        current_user, current_tenant_id = current_account_with_tenant()
        result = EnterpriseMarketplaceService.submit_asset(
            app=app_model,
            account=current_user,
            tenant_id=current_tenant_id,
            payload=payload,
        )
        return result.model_dump(mode="json"), 201


@console_ns.route("/enterprise-marketplace/submissions")
class EnterpriseMarketplaceMySubmissionsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, current_tenant_id = current_account_with_tenant()
        items = EnterpriseMarketplaceService.list_my_assets(tenant_id=current_tenant_id)
        return {"items": [item.model_dump(mode="json") for item in items]}, 200


@console_ns.route("/enterprise-marketplace/assets")
class EnterpriseMarketplaceAssetListApi(Resource):
    @console_ns.expect(console_ns.models[EnterpriseMarketplaceListQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        args = EnterpriseMarketplaceListQuery.model_validate(request.args.to_dict(flat=True))
        result = EnterpriseMarketplaceService.list_public_assets(
            page=args.page,
            limit=args.limit,
            keyword=args.keyword,
            category=args.category,
        )
        return result.model_dump(mode="json"), 200


@console_ns.route("/enterprise-marketplace/assets/<uuid:asset_id>")
class EnterpriseMarketplaceAssetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, asset_id):
        result = EnterpriseMarketplaceService.get_public_asset(str(asset_id))
        return result.model_dump(mode="json"), 200


@console_ns.route("/enterprise-marketplace/assets/<uuid:asset_id>/use")
class EnterpriseMarketplaceUseAssetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self, asset_id):
        current_user, _ = current_account_with_tenant()
        result = EnterpriseMarketplaceService.use_asset(asset_id=str(asset_id), account=current_user)
        status_code = 202 if result.import_result.status == "pending" else 200
        return result.model_dump(mode="json"), status_code


@console_ns.route("/platform-admin/enterprise-marketplace/assets")
class PlatformAdminEnterpriseMarketplaceAssetListApi(Resource):
    @console_ns.expect(console_ns.models[PlatformAdminEnterpriseMarketplaceListQuery.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    def get(self):
        args = PlatformAdminEnterpriseMarketplaceListQuery.model_validate(request.args.to_dict(flat=True))
        result = EnterpriseMarketplaceService.list_admin_assets(
            page=args.page,
            limit=args.limit,
            keyword=args.keyword,
            status=args.status,
        )
        return result.model_dump(mode="json"), 200


@console_ns.route("/platform-admin/enterprise-marketplace/assets/<uuid:asset_id>/review")
class PlatformAdminEnterpriseMarketplaceAssetReviewApi(Resource):
    @console_ns.expect(console_ns.models[EnterpriseMarketplaceReviewPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    def post(self, asset_id):
        current_user, _ = current_account_with_tenant()
        payload = EnterpriseMarketplaceReviewPayload.model_validate(console_ns.payload or {})
        result = EnterpriseMarketplaceService.review_asset(
            asset_id=str(asset_id),
            reviewer=current_user,
            payload=payload,
        )
        return result.model_dump(mode="json"), 200


@console_ns.route("/platform-admin/enterprise-marketplace/assets/<uuid:asset_id>/unlist")
class PlatformAdminEnterpriseMarketplaceAssetUnlistApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @platform_admin_required
    def post(self, asset_id):
        current_user, _ = current_account_with_tenant()
        result = EnterpriseMarketplaceService.unlist_asset(asset_id=str(asset_id), reviewer=current_user)
        return result.model_dump(mode="json"), 200
