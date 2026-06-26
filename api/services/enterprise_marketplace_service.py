from datetime import datetime
from enum import StrEnum
from uuid import uuid4

from flask import abort
from pydantic import BaseModel, Field
from sqlalchemy import String, cast, select
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from models import Account, App, EnterpriseMarketplaceAsset, Tenant
from services.app_dsl_service import AppDslService, CheckDependenciesResult, Import, ImportMode


class EnterpriseMarketplaceAssetStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    UNLISTED = "unlisted"


class EnterpriseMarketplaceSubmitPayload(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    category: str = Field(default="General", min_length=1, max_length=255)
    tags: list[str] = Field(default_factory=list)
    scenario: str = Field(default="", max_length=5000)
    allow_show_workspace_name: bool = False


class EnterpriseMarketplaceReviewPayload(BaseModel):
    status: EnterpriseMarketplaceAssetStatus
    review_note: str | None = Field(default=None, max_length=5000)


class EnterpriseMarketplaceAssetSummary(BaseModel):
    id: str
    source_tenant_id: str
    source_app_id: str
    status: str
    title: str
    description: str
    category: str
    tags: list[str] = Field(default_factory=list)
    scenario: str = ""
    allow_show_workspace_name: bool = False
    source_workspace_name: str | None = None
    submitter_account_id: str
    submitter_name: str | None = None
    reviewer_account_id: str | None = None
    review_note: str | None = None
    reviewed_at: int | None = None
    created_at: int
    updated_at: int
    app_name: str
    app_description: str
    app_mode: str
    app_icon_type: str | None = None
    app_icon: str | None = None
    app_icon_background: str | None = None


class EnterpriseMarketplaceListResult(BaseModel):
    items: list[EnterpriseMarketplaceAssetSummary]
    total: int
    page: int
    limit: int


class EnterpriseMarketplaceUseResult(BaseModel):
    import_result: Import
    leaked_dependencies: list[dict] = Field(default_factory=list)


class EnterpriseMarketplaceService:
    @staticmethod
    def _source_app_join_condition():
        return cast(App.id, String) == EnterpriseMarketplaceAsset.source_app_id

    @staticmethod
    def submit_asset(
        *,
        app: App,
        account: Account,
        tenant_id: str,
        payload: EnterpriseMarketplaceSubmitPayload,
    ) -> EnterpriseMarketplaceAssetSummary:
        if app.tenant_id != tenant_id:
            abort(404)

        asset = db.session.scalar(
            select(EnterpriseMarketplaceAsset).where(EnterpriseMarketplaceAsset.source_app_id == app.id).limit(1)
        )
        if asset is None:
            asset = EnterpriseMarketplaceAsset()
            asset.id = str(uuid4())
            asset.source_tenant_id = tenant_id
            asset.source_app_id = app.id
            asset.submitter_account_id = account.id
            db.session.add(asset)

        asset.title = payload.title
        asset.description = payload.description.strip()
        asset.category = payload.category.strip()
        asset.tags = EnterpriseMarketplaceService._normalize_tags(payload.tags)
        asset.scenario = payload.scenario.strip()
        asset.allow_show_workspace_name = payload.allow_show_workspace_name
        asset.status = EnterpriseMarketplaceAssetStatus.PENDING
        asset.review_note = None
        asset.reviewed_at = None
        asset.reviewer_account_id = None
        asset.submitter_account_id = account.id
        db.session.commit()
        db.session.refresh(asset)
        return EnterpriseMarketplaceService.serialize_asset(asset=asset, include_workspace_name=False)

    @staticmethod
    def list_my_assets(*, tenant_id: str) -> list[EnterpriseMarketplaceAssetSummary]:
        stmt = (
            select(EnterpriseMarketplaceAsset)
            .where(EnterpriseMarketplaceAsset.source_tenant_id == tenant_id)
            .order_by(EnterpriseMarketplaceAsset.updated_at.desc())
        )
        assets = db.session.scalars(stmt).all()
        return EnterpriseMarketplaceService.serialize_asset_list(assets=assets, include_workspace_name=True)

    @staticmethod
    def list_public_assets(
        *,
        page: int,
        limit: int,
        keyword: str | None = None,
        category: str | None = None,
    ) -> EnterpriseMarketplaceListResult:
        stmt = (
            select(EnterpriseMarketplaceAsset)
            .join(App, EnterpriseMarketplaceService._source_app_join_condition())
            .where(
                EnterpriseMarketplaceAsset.status == EnterpriseMarketplaceAssetStatus.APPROVED,
                App.status == "normal",
            )
        )
        if keyword:
            stmt = stmt.where(EnterpriseMarketplaceAsset.title.ilike(f"%{keyword.strip()}%"))
        if category:
            stmt = stmt.where(EnterpriseMarketplaceAsset.category == category.strip())

        pagination = db.paginate(
            select=stmt.order_by(EnterpriseMarketplaceAsset.updated_at.desc()),
            page=page,
            per_page=limit,
            error_out=False,
        )
        items = EnterpriseMarketplaceService.serialize_asset_list(
            assets=pagination.items,
            include_workspace_name=False,
        )
        return EnterpriseMarketplaceListResult(items=items, total=pagination.total, page=page, limit=limit)

    @staticmethod
    def get_public_asset(asset_id: str) -> EnterpriseMarketplaceAssetSummary:
        asset = EnterpriseMarketplaceService.get_asset(asset_id)
        if asset.status != EnterpriseMarketplaceAssetStatus.APPROVED:
            abort(404)
        return EnterpriseMarketplaceService.serialize_asset(asset=asset, include_workspace_name=False)

    @staticmethod
    def list_admin_assets(
        *,
        page: int,
        limit: int,
        keyword: str | None = None,
        status: EnterpriseMarketplaceAssetStatus | None = None,
    ) -> EnterpriseMarketplaceListResult:
        stmt = (
            select(EnterpriseMarketplaceAsset)
            .join(App, EnterpriseMarketplaceService._source_app_join_condition())
            .where(App.status == "normal")
        )
        if keyword:
            stmt = stmt.where(EnterpriseMarketplaceAsset.title.ilike(f"%{keyword.strip()}%"))
        if status:
            stmt = stmt.where(EnterpriseMarketplaceAsset.status == status)

        pagination = db.paginate(
            select=stmt.order_by(EnterpriseMarketplaceAsset.updated_at.desc()),
            page=page,
            per_page=limit,
            error_out=False,
        )
        items = EnterpriseMarketplaceService.serialize_asset_list(
            assets=pagination.items,
            include_workspace_name=True,
        )
        return EnterpriseMarketplaceListResult(items=items, total=pagination.total, page=page, limit=limit)

    @staticmethod
    def review_asset(
        *,
        asset_id: str,
        reviewer: Account,
        payload: EnterpriseMarketplaceReviewPayload,
    ) -> EnterpriseMarketplaceAssetSummary:
        asset = EnterpriseMarketplaceService.get_asset(asset_id)
        if payload.status == EnterpriseMarketplaceAssetStatus.UNLISTED:
            abort(400)

        asset.status = payload.status
        asset.review_note = payload.review_note.strip() if payload.review_note else None
        asset.reviewer_account_id = reviewer.id
        asset.reviewed_at = datetime.utcnow()
        db.session.commit()
        db.session.refresh(asset)
        return EnterpriseMarketplaceService.serialize_asset(asset=asset, include_workspace_name=True)

    @staticmethod
    def unlist_asset(*, asset_id: str, reviewer: Account) -> EnterpriseMarketplaceAssetSummary:
        asset = EnterpriseMarketplaceService.get_asset(asset_id)
        asset.status = EnterpriseMarketplaceAssetStatus.UNLISTED
        asset.reviewer_account_id = reviewer.id
        asset.reviewed_at = datetime.utcnow()
        db.session.commit()
        db.session.refresh(asset)
        return EnterpriseMarketplaceService.serialize_asset(asset=asset, include_workspace_name=True)

    @staticmethod
    def use_asset(*, asset_id: str, account: Account) -> EnterpriseMarketplaceUseResult:
        asset = EnterpriseMarketplaceService.get_asset(asset_id)
        if asset.status != EnterpriseMarketplaceAssetStatus.APPROVED:
            abort(404)

        source_app = asset.source_app
        if source_app is None or source_app.status != "normal":
            abort(404)

        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
            import_service = AppDslService(session)
            yaml_content = import_service.export_dsl(app_model=source_app, include_secret=False)
            import_result = import_service.import_app(
                account=account,
                import_mode=ImportMode.YAML_CONTENT,
                yaml_content=yaml_content,
                name=asset.title,
                description=asset.description or source_app.description,
                icon_type=source_app.icon_type.value if source_app.icon_type else None,
                icon=source_app.icon,
                icon_background=source_app.icon_background,
            )

            dependency_result = CheckDependenciesResult()
            if import_result.app_id:
                imported_app = session.get(App, import_result.app_id)
                if imported_app is not None:
                    dependency_result = import_service.check_dependencies(app_model=imported_app)

        leaked_dependencies = [
            dependency.model_dump(mode="json") for dependency in dependency_result.leaked_dependencies
        ]
        return EnterpriseMarketplaceUseResult(import_result=import_result, leaked_dependencies=leaked_dependencies)

    @staticmethod
    def get_asset(asset_id: str) -> EnterpriseMarketplaceAsset:
        asset = db.session.get(EnterpriseMarketplaceAsset, asset_id)
        if asset is None:
            abort(404)
        return asset

    @staticmethod
    def serialize_asset(
        *,
        asset: EnterpriseMarketplaceAsset,
        include_workspace_name: bool,
        source_app: App | None = None,
        submitter: Account | None = None,
        source_tenant: Tenant | None = None,
    ) -> EnterpriseMarketplaceAssetSummary:
        source_app = source_app or asset.source_app
        if source_app is None:
            abort(404)

        submitter = submitter or db.session.get(Account, asset.submitter_account_id)
        source_tenant = source_tenant or db.session.get(Tenant, asset.source_tenant_id)

        return EnterpriseMarketplaceAssetSummary(
            id=asset.id,
            source_tenant_id=asset.source_tenant_id,
            source_app_id=asset.source_app_id,
            status=asset.status,
            title=asset.title,
            description=asset.description or "",
            category=asset.category,
            tags=list(asset.tags or []),
            scenario=asset.scenario or "",
            allow_show_workspace_name=asset.allow_show_workspace_name,
            source_workspace_name=(
                source_tenant.name
                if source_tenant and (include_workspace_name or asset.allow_show_workspace_name)
                else None
            ),
            submitter_account_id=asset.submitter_account_id,
            submitter_name=submitter.name if submitter else None,
            reviewer_account_id=asset.reviewer_account_id,
            review_note=asset.review_note,
            reviewed_at=EnterpriseMarketplaceService._ts(asset.reviewed_at),
            created_at=EnterpriseMarketplaceService._ts(asset.created_at) or 0,
            updated_at=EnterpriseMarketplaceService._ts(asset.updated_at) or 0,
            app_name=source_app.name,
            app_description=source_app.description or "",
            app_mode=source_app.mode.value if hasattr(source_app.mode, "value") else str(source_app.mode),
            app_icon_type=source_app.icon_type.value if source_app.icon_type else None,
            app_icon=source_app.icon,
            app_icon_background=source_app.icon_background,
        )

    @staticmethod
    def serialize_asset_list(
        *,
        assets: list[EnterpriseMarketplaceAsset],
        include_workspace_name: bool,
    ) -> list[EnterpriseMarketplaceAssetSummary]:
        if not assets:
            return []

        app_ids = [asset.source_app_id for asset in assets]
        submitter_ids = [asset.submitter_account_id for asset in assets]
        tenant_ids = [asset.source_tenant_id for asset in assets]

        source_apps = db.session.scalars(select(App).where(App.id.in_(app_ids))).all()
        source_apps_by_id = {app.id: app for app in source_apps}

        submitters = db.session.scalars(select(Account).where(Account.id.in_(submitter_ids))).all()
        submitters_by_id = {account.id: account for account in submitters}

        source_tenants = db.session.scalars(select(Tenant).where(Tenant.id.in_(tenant_ids))).all()
        source_tenants_by_id = {tenant.id: tenant for tenant in source_tenants}

        items: list[EnterpriseMarketplaceAssetSummary] = []
        for asset in assets:
            source_app = source_apps_by_id.get(asset.source_app_id)
            if source_app is None or source_app.status != "normal":
                continue

            items.append(
                EnterpriseMarketplaceService.serialize_asset(
                    asset=asset,
                    include_workspace_name=include_workspace_name,
                    source_app=source_app,
                    submitter=submitters_by_id.get(asset.submitter_account_id),
                    source_tenant=source_tenants_by_id.get(asset.source_tenant_id),
                )
            )

        return items

    @staticmethod
    def _normalize_tags(tags: list[str]) -> list[str]:
        unique_tags: list[str] = []
        for tag in tags:
            normalized = tag.strip()
            if normalized and normalized not in unique_tags:
                unique_tags.append(normalized[:64])
        return unique_tags[:10]

    @staticmethod
    def _ts(value: datetime | None) -> int | None:
        if value is None:
            return None
        return int(value.timestamp())
