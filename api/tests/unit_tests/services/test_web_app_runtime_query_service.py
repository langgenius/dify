from unittest.mock import MagicMock, create_autospec

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from models.model import UploadFile
from services.app_definition_query_service import AppSiteConfiguration
from services.entities.feature_entities import FeatureModel
from services.file_service import FileService
from services.web_app_runtime_query_service import (
    WebAppBootstrap,
    WebAppRuntimeQuery,
    WebAppRuntimeQueryService,
    WebAppRuntimeRecord,
    WebAppRuntimeUnavailableError,
)
from tests.unit_tests.model_factories import make_upload_file

_FILES_URL = "https://files.example.com"


@pytest.fixture
def file_service(sqlite_session_factory: sessionmaker[Session], mocker: MockerFixture) -> FileService:
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id="file-1", tenant_id="tenant-1"))
    mocker.patch("services.file_service.file_helpers.get_signed_file_url", return_value="https://icon")
    return FileService(sqlite_session_factory)


@pytest.fixture
def workspace_features() -> MagicMock:
    return MagicMock(return_value=FeatureModel())


def _site_configuration() -> AppSiteConfiguration:
    return AppSiteConfiguration(
        title="Test Site",
        chat_color_theme="light",
        chat_color_theme_inverted=False,
        icon_type="image",
        icon="file-1",
        icon_background="#ffffff",
        description="Description",
        copyright="Copyright",
        privacy_policy="Privacy",
        input_placeholder="Ask anything",
        custom_disclaimer="Disclaimer",
        default_language="en-US",
        prompt_public=True,
        show_workflow_steps=True,
        use_icon_as_answer_icon=False,
    )


def _runtime_record(
    *,
    mode: str = "agent-chat",
    tenant_status: str = "normal",
    tenant_custom_config_json: str | None = '{"remove_webapp_brand":true,"replace_webapp_logo":"file-2"}',
) -> WebAppRuntimeRecord:
    return WebAppRuntimeRecord(
        app_id="app-1",
        tenant_id="tenant-1",
        mode=mode,
        enable_site=True,
        site=_site_configuration(),
        plan="pro",
        tenant_status=tenant_status,
        tenant_custom_config_json=tenant_custom_config_json,
    )


def _service(
    runtime: MagicMock,
    *,
    deployment_edition: DeploymentEdition = DeploymentEdition.COMMUNITY,
    file_service: FileService,
    workspace_features: MagicMock | None = None,
) -> WebAppRuntimeQueryService:
    if workspace_features is None:
        workspace_features = MagicMock(return_value=FeatureModel())
    return WebAppRuntimeQueryService(
        runtime=runtime,
        file_service=file_service,
        workspace_features=workspace_features,
        files_url=_FILES_URL,
        deployment_edition=deployment_edition,
    )


@pytest.mark.parametrize("record", [None, _runtime_record(tenant_status="archive")])
def test_get_bootstrap_rejects_unavailable_runtime(
    record: WebAppRuntimeRecord | None, file_service: FileService
) -> None:
    runtime: MagicMock = create_autospec(WebAppRuntimeQuery, instance=True, spec_set=True)
    runtime.get_runtime_record.return_value = record

    with pytest.raises(WebAppRuntimeUnavailableError, match="Site not found"):
        _service(runtime, file_service=file_service).get_bootstrap("app-1")


@pytest.mark.parametrize(
    ("deployment_edition", "copyright_enabled", "expected_copyright", "expected_placeholder"),
    [
        (DeploymentEdition.CLOUD, False, None, None),
        (DeploymentEdition.CLOUD, True, "Copyright", "Ask anything"),
        (DeploymentEdition.COMMUNITY, False, "Copyright", "Ask anything"),
        (DeploymentEdition.ENTERPRISE, False, "Copyright", "Ask anything"),
    ],
)
def test_get_bootstrap_applies_feature_and_branding_policy_after_record_load(
    workspace_features: MagicMock,
    file_service: FileService,
    deployment_edition: DeploymentEdition,
    copyright_enabled: bool,
    expected_copyright: str | None,
    expected_placeholder: str | None,
    mocker: MockerFixture,
) -> None:
    runtime: MagicMock = create_autospec(WebAppRuntimeQuery, instance=True, spec_set=True)
    record = _runtime_record()
    features = FeatureModel(can_replace_logo=True, webapp_copyright_enabled=copyright_enabled)
    events: list[str] = []
    runtime.get_runtime_record.side_effect = lambda _app_id: events.append("record") or record
    workspace_features.side_effect = lambda _tenant_id, **_kwargs: events.append("features") or features
    icon = mocker.spy(file_service, "get_icon_url")
    mocker.patch(
        "services.file_service.file_helpers.get_signed_file_url",
        side_effect=lambda **_kwargs: events.append("icon") or "https://icon",
    )

    result = _service(
        runtime,
        file_service=file_service,
        workspace_features=workspace_features,
        deployment_edition=deployment_edition,
    ).get_bootstrap("app-1")

    assert result == WebAppBootstrap(
        app_id="app-1",
        mode="agent-chat",
        enable_site=True,
        site={
            **record.site._asdict(),
            "copyright": expected_copyright,
            "input_placeholder": expected_placeholder,
            "icon_url": "https://icon",
        },
        plan="pro",
        can_replace_logo=True,
        custom_config={
            "remove_webapp_brand": True,
            "replace_webapp_logo": "https://files.example.com/files/workspaces/tenant-1/webapp-logo",
        },
    )
    assert events == ["record", "features", "icon"]
    workspace_features.assert_called_once_with("tenant-1")
    icon.assert_called_once_with("file-1", "tenant-1")


def test_get_bootstrap_skips_legacy_custom_config_when_branding_is_not_allowed(
    workspace_features: MagicMock,
    file_service: FileService,
) -> None:
    runtime: MagicMock = create_autospec(WebAppRuntimeQuery, instance=True, spec_set=True)
    record = _runtime_record(tenant_custom_config_json="not-json")
    runtime.get_runtime_record.return_value = record

    workspace_features.return_value = FeatureModel(can_replace_logo=False)

    result = _service(runtime, file_service=file_service, workspace_features=workspace_features).get_bootstrap("app-1")

    assert result.site == {**record.site._asdict(), "icon_url": "https://icon"}
    assert result.can_replace_logo is False
    assert result.custom_config is None


def test_get_bootstrap_falls_back_when_site_icon_is_unavailable(
    file_service: FileService, sqlite_session: Session
) -> None:
    runtime: MagicMock = create_autospec(WebAppRuntimeQuery, instance=True, spec_set=True)
    runtime.get_runtime_record.return_value = _runtime_record()
    file = sqlite_session.get(UploadFile, "file-1")
    assert file is not None
    sqlite_session.delete(file)
    sqlite_session.commit()

    result = _service(runtime, file_service=file_service).get_bootstrap("app-1")

    assert result.site["icon_type"] == "emoji"
    assert result.site["icon"] == "🤖"
    assert result.site["icon_background"] == "#FFEAD5"
    assert result.site["icon_url"] is None
