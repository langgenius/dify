"""Real SQL cohorts, App authorization and owned refreshable image capabilities."""

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import event

from graphon.file.helpers import verify_file_signature
from models.agent import Agent, AgentIconType, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.base import TypeBase
from models.external_agent import ExternalAgentFileLease
from models.model import App, AppMode, UploadFile
from models.workflow import Workflow, WorkflowType
from repositories.external_agents.observability_repository import DatabaseExternalObservationAccess
from services.external_agents.contracts import AssetPage, ExternalAgentInvalidInputError
from tests.helpers.unit.model_factories import make_upload_file
from tests.unit_tests.repositories.external_agents.test_runtime_repository import bound_engine, stored, uid
from tests.unit_tests.services.external_agents import test_control_plane_applications as control_fixtures
from tests.unit_tests.services.external_agents.test_control_plane_applications import ControlPlane

domain = control_fixtures.domain
control = control_fixtures.control


def page(
    control: ControlPlane,
    *,
    enabled: bool | None = None,
    keyword: str | None = None,
    mine: bool = False,
    order: str = "asc",
) -> AssetPage:
    return control.assets.list(
        control.context,
        page=1,
        limit=100,
        keyword=keyword,
        enabled=enabled,
        connected_by_me=mine,
        sort_by="created_at",
        sort_order="asc" if order == "asc" else "desc",
    )


def test_created_sort_and_tab_counts_share_search_creator_and_visibility_cohort(control: ControlPlane) -> None:
    control.assets.delete(control.context, control.database[3])
    first = control.create(metadata={"name": "Match old"}).resource_id
    second = control.create(metadata={"name": "Match new"}).resource_id
    third = control.create(metadata={"name": "Other"}).resource_id
    when = datetime(2026, 1, 1)
    with control.database[1].begin() as session:
        for index, identifier in enumerate((first, second, third)):
            row = stored(session, Agent, identifier)
            row.created_at = when + timedelta(days=index)
            row.updated_at = when - timedelta(days=index)
        stored(session, Agent, second).created_by = uid()
    control.assets.set_enabled(control.context, second, False)
    default = control.assets.list(control.context, page=1, limit=100, keyword=None, enabled=None, connected_by_me=False)
    assert [asset.id for asset in default.items] == [second, first, third]
    assert [asset.id for asset in page(control).items] == [first, second, third]
    assert [asset.id for asset in page(control, order="desc").items] == [third, second, first]
    for selected in (None, True, False):
        result = page(control, enabled=selected, keyword="Match")
        assert result.enabled_count == 1
        assert result.disabled_count == 1
        assert result.total == (2 if selected is None else 1)
    own = page(control, keyword="Match", mine=True)
    assert own.total == own.enabled_count == 1
    assert own.disabled_count == 0
    control.access.visibility = frozenset({third})
    visible = page(control, enabled=False)
    assert visible.items == ()
    assert visible.enabled_count == 1
    assert visible.disabled_count == visible.total == 0
    empty = page(control, keyword="not-present")
    assert empty.total == empty.enabled_count == empty.disabled_count == 0


def bind_app(
    control: ControlPlane, agents: tuple[str, ...], *, tenant: str | None = None, historical: bool = False
) -> str:
    tenant_id, app_id, workflow_id = tenant or control.context.active_workspace_id, uid(), uid()
    with control.database[1].begin() as session:
        session.add(
            App(
                id=app_id,
                tenant_id=tenant_id,
                name="Referenced App",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
            )
        )
        session.add(
            Workflow(
                id=workflow_id,
                tenant_id=tenant_id,
                app_id=app_id,
                type=WorkflowType.WORKFLOW,
                version="old-version" if historical else "draft",
                graph='{"nodes":[],"edges":[]}',
                _features="{}",
                created_by=control.context.account_id,
            )
        )
        for index, agent in enumerate(agents):
            session.add(
                WorkflowAgentNodeBinding(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    workflow_id=workflow_id,
                    workflow_version="old-version" if historical else "draft",
                    node_id=f"node-{index}",
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    agent_id=agent,
                    node_job_config={},
                    binding_epoch="epoch",
                    external_job_config={},
                )
            )
    return app_id


def test_list_reference_count_deduplicates_readable_apps_and_uses_one_grouped_query(control: ControlPlane) -> None:
    first, second = control.database[3], control.create(metadata={"name": "Second"}).resource_id
    visible = bind_app(control, (first, first, second))
    hidden = bind_app(control, (first,))
    bind_app(control, (first,), tenant=uid())
    bind_app(control, (first,), historical=True)
    control.access.reference_ids = frozenset({visible})
    statements: list[str] = []

    def capture(
        _connection: object, _cursor: object, statement: str, _parameters: object, _context: object, _many: bool
    ) -> None:
        statements.append(statement)

    engine = bound_engine(control.database[1])
    event.listen(engine, "before_cursor_execute", capture)
    try:
        result = page(control)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert {asset.id: asset.reference_count for asset in result.items} == {first: 1, second: 1}
    binding_reads = [sql for sql in statements if "workflow_agent_node_bindings" in sql]
    assert len(binding_reads) == 1
    assert "count(distinct" in binding_reads[0].lower()
    assert len(control.assets.references(control.context, first).apps) == 1
    assert control.assets.references(control.context, first).apps[0].app_id == visible
    assert hidden != visible
    from models.account import TenantAccountRole

    control.role(TenantAccountRole.NORMAL)
    assert all(asset.reference_count is None for asset in page(control).items)


def test_list_scope_is_monitoring_scope_intersected_with_admitted_apps(control: ControlPlane) -> None:
    from models.account import TenantAccountRole
    from services.rbac.contracts import MyPermissionsResponse, ResourcePermissionKeys, ResourcePermissionSnapshot

    first = bind_app(control, (control.database[3],))
    second = bind_app(control, (control.database[3],))

    class AppPermissions:
        calls = 0

        def permissions(self, workspace_id: str, account_id: str | None, **_: object) -> MyPermissionsResponse:
            assert workspace_id == control.context.active_workspace_id
            assert account_id == control.context.account_id
            self.calls += 1
            return MyPermissionsResponse(
                app=ResourcePermissionSnapshot(
                    overrides=[
                        ResourcePermissionKeys(resource_id=identifier, permission_keys=["app.acl.monitor"])
                        for identifier in (first, second)
                    ]
                )
            )

    permissions = AppPermissions()
    access = DatabaseExternalObservationAccess(
        sessions=control.database[1], assets=control.access, permissions=permissions
    )
    context = control.context._replace(resource_app_ids=frozenset({first}))
    assert (
        access.reference_list_app_ids(context)
        == access.reference_app_ids(context, control.database[3])
        == frozenset({first})
    )
    assert access.monitor(context, control.database[3]).app_ids == frozenset({first})
    control.role(TenantAccountRole.NORMAL)
    count = permissions.calls
    assert access.reference_list_app_ids(context) is None
    assert permissions.calls == count


@pytest.fixture
def icon_control(control: ControlPlane) -> ControlPlane:
    TypeBase.metadata.create_all(
        bound_engine(control.database[1]), tables=[TypeBase.metadata.tables[UploadFile.__tablename__]]
    )
    return control


def image_upload(control: ControlPlane, *, tenant: str | None = None, media_type: str = "image/png") -> str:
    file_id = uid()
    with control.database[1].begin() as session:
        session.add(
            make_upload_file(
                file_id=file_id,
                tenant_id=tenant or control.context.active_workspace_id,
                created_by=control.context.account_id,
                name="icon.png",
                extension="png",
                mime_type=media_type,
            )
        )
    return file_id


def test_image_urls_are_tenant_owned_refreshable_and_do_not_persist_signatures(icon_control: ControlPlane) -> None:
    control = icon_control
    image = image_upload(control)
    asset = control.create(metadata={"name": "Image", "icon_type": "image", "icon": image}).resource_id
    first = control.assets.detail(control.context, asset)["asset"]
    second = control.assets.detail(control.context, asset)["asset"]
    assert isinstance(first["icon_url"], str)
    assert image in first["icon_url"]
    assert first["icon_url"] != second["icon_url"]
    query = parse_qs(urlsplit(first["icon_url"]).query)
    assert verify_file_signature(
        upload_file_id=image, timestamp=query["timestamp"][0], nonce=query["nonce"][0], sign=query["sign"][0]
    )
    stored_asset = control.store.get_asset(tenant_id=control.context.active_workspace_id, agent_id=asset)
    assert stored_asset.icon == image
    assert stored_asset.icon_url is None
    listed = next(item for item in page(control).items if item.id == asset)
    assert listed.icon_url is not None
    with control.database[1].begin() as session:
        session.delete(stored(session, UploadFile, image))
    assert control.assets.detail(control.context, asset)["asset"]["icon_url"] is None


@pytest.mark.parametrize("kind", ["foreign", "missing", "not_image", "temporary"])
def test_image_writes_refuse_unowned_or_temporary_files_and_legacy_reads_withhold_url(
    icon_control: ControlPlane, kind: str
) -> None:
    control = icon_control
    identifier = (
        uid()
        if kind == "missing"
        else image_upload(
            control,
            tenant=uid() if kind == "foreign" else None,
            media_type="text/plain" if kind == "not_image" else "image/png",
        )
    )
    if kind == "temporary":
        with control.database[1].begin() as session:
            session.add(
                ExternalAgentFileLease(
                    id=uid(),
                    tenant_id=control.context.active_workspace_id,
                    owner_id=control.context.account_id,
                    agent_id=control.database[3],
                    page_session_id="test",
                    file_id=identifier,
                    temporary_copy=True,
                    purpose="input",
                    storage_key="temporary/icon",
                    size=10,
                    media_type="image/png",
                    expires_at=datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=1),
                )
            )
    with pytest.raises(ExternalAgentInvalidInputError, match="Image icon"):
        control.create(metadata={"name": "Rejected image", "icon_type": "image", "icon": identifier})
    with control.database[1].begin() as session:
        row = stored(session, Agent, control.database[3])
        row.icon_type, row.icon = AgentIconType.IMAGE, identifier
    assert control.assets.detail(control.context, control.database[3])["asset"]["icon_url"] is None
    with pytest.raises(ExternalAgentInvalidInputError, match="Image icon"):
        control.assets.update_info(
            control.context,
            agent_id=control.database[3],
            expected_revision=1,
            changes={"icon_type": "image", "icon": identifier},
        )


@pytest.mark.parametrize(("kind", "icon"), [("emoji", "🔎"), ("link", "https://icons.example/icon.png")])
def test_non_image_icons_keep_the_existing_raw_value_and_no_image_url(
    control: ControlPlane, kind: str, icon: str
) -> None:
    identifier = control.create(metadata={"name": "Icon", "icon_type": kind, "icon": icon}).resource_id
    displayed = control.assets.detail(control.context, identifier)["asset"]
    assert displayed["icon"] == icon
    assert displayed["icon_url"] is None
