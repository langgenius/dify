from types import SimpleNamespace
from unittest.mock import Mock, call

import pytest
from sqlalchemy.sql import Select

from services.enterprise_marketplace_service import EnterpriseMarketplaceAssetStatus, EnterpriseMarketplaceService


def test_serialize_asset_list_should_pass_prefetched_models_to_serializer(monkeypatch: pytest.MonkeyPatch) -> None:
    asset_a = SimpleNamespace(
        id="asset-a",
        source_app_id="app-a",
        submitter_account_id="account-a",
        source_tenant_id="tenant-a",
    )
    asset_b = SimpleNamespace(
        id="asset-b",
        source_app_id="app-b",
        submitter_account_id="account-b",
        source_tenant_id="tenant-b",
    )

    app_a = SimpleNamespace(id="app-a", status="normal")
    app_b = SimpleNamespace(id="app-b", status="normal")
    submitter_a = SimpleNamespace(id="account-a", name="Alice")
    submitter_b = SimpleNamespace(id="account-b", name="Bob")
    tenant_a = SimpleNamespace(id="tenant-a", name="Workspace A")
    tenant_b = SimpleNamespace(id="tenant-b", name="Workspace B")

    mocked_db = Mock()
    monkeypatch.setattr("services.enterprise_marketplace_service.db", mocked_db)
    mocked_db.session.scalars.side_effect = [
        SimpleNamespace(all=lambda: [app_a, app_b]),
        SimpleNamespace(all=lambda: [submitter_a, submitter_b]),
        SimpleNamespace(all=lambda: [tenant_a, tenant_b]),
    ]

    serialize_asset = Mock(
        side_effect=lambda *, asset, include_workspace_name, source_app=None, submitter=None, source_tenant=None: {
            "asset_id": asset.id,
            "source_app_id": source_app.id if source_app else None,
            "submitter_id": submitter.id if submitter else None,
            "tenant_id": source_tenant.id if source_tenant else None,
            "include_workspace_name": include_workspace_name,
        },
    )
    monkeypatch.setattr(EnterpriseMarketplaceService, "serialize_asset", serialize_asset)

    items = EnterpriseMarketplaceService.serialize_asset_list(
        assets=[asset_a, asset_b],
        include_workspace_name=True,
    )

    assert items == [
        {
            "asset_id": "asset-a",
            "source_app_id": "app-a",
            "submitter_id": "account-a",
            "tenant_id": "tenant-a",
            "include_workspace_name": True,
        },
        {
            "asset_id": "asset-b",
            "source_app_id": "app-b",
            "submitter_id": "account-b",
            "tenant_id": "tenant-b",
            "include_workspace_name": True,
        },
    ]
    assert mocked_db.session.scalars.call_count == 3
    serialize_asset.assert_has_calls(
        [
            call(
                asset=asset_a,
                include_workspace_name=True,
                source_app=app_a,
                submitter=submitter_a,
                source_tenant=tenant_a,
            ),
            call(
                asset=asset_b,
                include_workspace_name=True,
                source_app=app_b,
                submitter=submitter_b,
                source_tenant=tenant_b,
            ),
        ]
    )


def test_serialize_asset_list_should_skip_assets_without_normal_source_apps(monkeypatch: pytest.MonkeyPatch) -> None:
    asset = SimpleNamespace(
        id="asset-a",
        source_app_id="app-a",
        submitter_account_id="account-a",
        source_tenant_id="tenant-a",
    )
    archived_app = SimpleNamespace(id="app-a", status="archived")

    mocked_db = Mock()
    monkeypatch.setattr("services.enterprise_marketplace_service.db", mocked_db)
    mocked_db.session.scalars.side_effect = [
        SimpleNamespace(all=lambda: [archived_app]),
        SimpleNamespace(all=lambda: [SimpleNamespace(id="account-a")]),
        SimpleNamespace(all=lambda: [SimpleNamespace(id="tenant-a")]),
    ]

    serialize_asset = Mock()
    monkeypatch.setattr(EnterpriseMarketplaceService, "serialize_asset", serialize_asset)

    items = EnterpriseMarketplaceService.serialize_asset_list(
        assets=[asset],
        include_workspace_name=False,
    )

    assert items == []
    serialize_asset.assert_not_called()


def test_list_public_assets_should_filter_out_non_normal_source_apps_in_query(monkeypatch: pytest.MonkeyPatch) -> None:
    mocked_db = Mock()
    monkeypatch.setattr("services.enterprise_marketplace_service.db", mocked_db)
    mocked_db.paginate.side_effect = lambda *, select, page, per_page, error_out: _capture_paginate_args(
        select_statement=select,
        page=page,
        per_page=per_page,
        error_out=error_out,
    )
    monkeypatch.setattr(EnterpriseMarketplaceService, "serialize_asset_list", Mock(return_value=[]))

    result = EnterpriseMarketplaceService.list_public_assets(
        page=2,
        limit=24,
        keyword="bot",
        category="Support",
    )

    assert result.total == 0
    captured_select = mocked_db.paginate.call_args.kwargs["select"]
    compiled_sql = str(captured_select.compile(compile_kwargs={"literal_binds": True}))
    assert "JOIN apps" in compiled_sql
    assert "CAST(apps.id AS VARCHAR)" in compiled_sql
    assert "enterprise_marketplace_assets.status = 'approved'" in compiled_sql
    assert "apps.status = 'normal'" in compiled_sql
    assert "enterprise_marketplace_assets.category = 'Support'" in compiled_sql
    assert mocked_db.paginate.call_args.kwargs["page"] == 2
    assert mocked_db.paginate.call_args.kwargs["per_page"] == 24


def test_list_admin_assets_should_filter_out_non_normal_source_apps_in_query(monkeypatch: pytest.MonkeyPatch) -> None:
    mocked_db = Mock()
    monkeypatch.setattr("services.enterprise_marketplace_service.db", mocked_db)
    mocked_db.paginate.side_effect = lambda *, select, page, per_page, error_out: _capture_paginate_args(
        select_statement=select,
        page=page,
        per_page=per_page,
        error_out=error_out,
    )
    monkeypatch.setattr(EnterpriseMarketplaceService, "serialize_asset_list", Mock(return_value=[]))

    result = EnterpriseMarketplaceService.list_admin_assets(
        page=1,
        limit=50,
        keyword="agent",
        status=EnterpriseMarketplaceAssetStatus.PENDING,
    )

    assert result.total == 0
    captured_select = mocked_db.paginate.call_args.kwargs["select"]
    compiled_sql = str(captured_select.compile(compile_kwargs={"literal_binds": True}))
    assert "JOIN apps" in compiled_sql
    assert "CAST(apps.id AS VARCHAR)" in compiled_sql
    assert "apps.status = 'normal'" in compiled_sql
    assert "enterprise_marketplace_assets.status = 'pending'" in compiled_sql
    assert "enterprise_marketplace_assets.title" in compiled_sql
    assert "%agent%" in compiled_sql


def _capture_paginate_args(*, select_statement: Select, page: int, per_page: int, error_out: bool) -> SimpleNamespace:
    assert isinstance(select_statement, Select)
    assert error_out is False
    return SimpleNamespace(items=[], total=0, page=page, per_page=per_page)
