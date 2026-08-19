from collections.abc import Iterator
from unittest.mock import MagicMock, create_autospec, patch

import pytest

from configs import dify_config
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

_FILES_URL = "https://files.example.com"


@pytest.fixture(autouse=True)
def workspace_features() -> Iterator[MagicMock]:
    with (
        patch.object(dify_config, "FILES_URL", _FILES_URL),
        patch(
            "services.web_app_runtime_query_service.FeatureService.get_features",
            return_value=FeatureModel(),
        ) as get_features,
    ):
        yield get_features


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
    tenant_status: str = "normal",
    tenant_custom_config_json: str | None = '{"remove_webapp_brand":true,"replace_webapp_logo":"file-2"}',
) -> WebAppRuntimeRecord:
    return WebAppRuntimeRecord(
        app_id="app-1",
        tenant_id="tenant-1",
        enable_site=True,
        site=_site_configuration(),
        plan="pro",
        tenant_status=tenant_status,
        tenant_custom_config_json=tenant_custom_config_json,
    )


def _service(
    runtime: MagicMock,
    *,
    file_service: MagicMock | None = None,
) -> WebAppRuntimeQueryService:
    if file_service is None:
        file_service = MagicMock(spec=FileService)
        file_service.get_icon_url.return_value = None
    return WebAppRuntimeQueryService(
        runtime=runtime,
        file_service=file_service,
    )


@pytest.mark.parametrize("record", [None, _runtime_record(tenant_status="archive")])
def test_get_bootstrap_rejects_unavailable_runtime(record: WebAppRuntimeRecord | None) -> None:
    runtime: MagicMock = create_autospec(WebAppRuntimeQuery, instance=True, spec_set=True)
    runtime.get_runtime_record.return_value = record

    with pytest.raises(WebAppRuntimeUnavailableError, match="Site not found"):
        _service(runtime).get_bootstrap("app-1")

    runtime.resolve_compatible_app_mode.assert_not_called()


def test_get_bootstrap_rejects_missing_compatible_mode() -> None:
    runtime: MagicMock = create_autospec(WebAppRuntimeQuery, instance=True, spec_set=True)
    runtime.get_runtime_record.return_value = _runtime_record()
    runtime.resolve_compatible_app_mode.return_value = None

    with pytest.raises(WebAppRuntimeUnavailableError, match="Site not found"):
        _service(runtime).get_bootstrap("app-1")


def test_get_bootstrap_applies_feature_and_branding_policy_after_record_load(
    workspace_features: MagicMock,
) -> None:
    runtime: MagicMock = create_autospec(WebAppRuntimeQuery, instance=True, spec_set=True)
    record = _runtime_record()
    features = FeatureModel(can_replace_logo=True, webapp_copyright_enabled=False)
    features.billing.enabled = True
    events: list[str] = []
    runtime.get_runtime_record.side_effect = lambda _app_id: events.append("record") or record
    runtime.resolve_compatible_app_mode.side_effect = lambda _app_id: events.append("mode") or "agent-chat"
    workspace_features.side_effect = lambda _tenant_id, **_kwargs: events.append("features") or features
    file_service = MagicMock(spec=FileService)
    file_service.get_icon_url.side_effect = lambda *_args, **_kwargs: events.append("icon") or "https://icon"

    result = _service(runtime, file_service=file_service).get_bootstrap("app-1")

    assert result == WebAppBootstrap(
        app_id="app-1",
        mode="agent-chat",
        enable_site=True,
        site={
            **record.site._asdict(),
            "copyright": None,
            "input_placeholder": None,
            "icon_url": "https://icon",
        },
        plan="pro",
        can_replace_logo=True,
        custom_config={
            "remove_webapp_brand": True,
            "replace_webapp_logo": "https://files.example.com/files/workspaces/tenant-1/webapp-logo",
        },
    )
    assert events == ["record", "features", "mode", "icon"]
    workspace_features.assert_called_once_with("tenant-1", exclude_vector_space=True)
    file_service.get_icon_url.assert_called_once_with("file-1", "tenant-1")


def test_get_bootstrap_skips_legacy_custom_config_when_branding_is_not_allowed(
    workspace_features: MagicMock,
) -> None:
    runtime: MagicMock = create_autospec(WebAppRuntimeQuery, instance=True, spec_set=True)
    record = _runtime_record(tenant_custom_config_json="not-json")
    runtime.get_runtime_record.return_value = record
    runtime.resolve_compatible_app_mode.return_value = "chat"

    workspace_features.return_value = FeatureModel(can_replace_logo=False)

    result = _service(runtime).get_bootstrap("app-1")

    assert result.site == {**record.site._asdict(), "icon_url": None}
    assert result.can_replace_logo is False
    assert result.custom_config is None
