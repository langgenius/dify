from types import SimpleNamespace
from unittest.mock import MagicMock

from pytest_mock import MockerFixture

from core.helper.marketplace import (
    batch_fetch_plugin_by_ids,
    batch_fetch_plugin_manifests,
    download_plugin_pkg,
    fetch_global_plugin_manifest,
    get_plugin_pkg_url,
    record_install_plugin_event,
)


def test_get_plugin_pkg_url_contains_unique_identifier() -> None:
    url = get_plugin_pkg_url("plugin@1.0.0")

    assert "api/v1/plugins/download" in url
    assert "unique_identifier=plugin@1.0.0" in url


def test_download_plugin_pkg_delegates_with_configured_size(mocker: MockerFixture) -> None:
    mocked_download = mocker.patch("core.helper.marketplace.download_with_size_limit", return_value=b"pkg")
    mocker.patch("core.helper.marketplace.dify_config.PLUGIN_MAX_PACKAGE_SIZE", 1234)

    result = download_plugin_pkg("plugin.a.b")

    assert result == b"pkg"
    mocked_download.assert_called_once()
    called_url, called_limit = mocked_download.call_args.args
    assert "unique_identifier=plugin.a.b" in called_url
    assert called_limit == 1234


def test_batch_fetch_plugin_by_ids_returns_empty_for_empty_input(mocker: MockerFixture) -> None:
    post_mock = mocker.patch("core.helper.marketplace.httpx.post")

    assert batch_fetch_plugin_by_ids([]) == []
    post_mock.assert_not_called()


def test_batch_fetch_plugin_by_ids_returns_plugins_from_response(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.json.return_value = {"data": {"plugins": [{"id": "p1"}]}}
    response.raise_for_status.return_value = None
    post_mock = mocker.patch("core.helper.marketplace.httpx.post", return_value=response)

    plugins = batch_fetch_plugin_by_ids(["p1"])

    assert plugins == [{"id": "p1"}]
    post_mock.assert_called_once()
    response.raise_for_status.assert_called_once()


def test_batch_fetch_plugin_manifests_returns_empty_for_empty_input(mocker: MockerFixture) -> None:
    post_mock = mocker.patch("core.helper.marketplace.httpx.post")

    assert batch_fetch_plugin_manifests([]) == []
    post_mock.assert_not_called()


def test_batch_fetch_plugin_manifests_validates_and_returns_plugins(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"data": {"plugins": [{"id": "p1"}, {"id": "p2"}]}}
    post_mock = mocker.patch("core.helper.marketplace.httpx.post", return_value=response)
    validate_mock = mocker.patch(
        "core.helper.marketplace.MarketplacePluginDeclaration.model_validate",
        side_effect=["manifest-1", "manifest-2"],
    )

    result = batch_fetch_plugin_manifests(["p1", "p2"])

    assert result == ["manifest-1", "manifest-2"]
    post_mock.assert_called_once()
    assert validate_mock.call_count == 2
    response.raise_for_status.assert_called_once()


def test_record_install_plugin_event_posts_and_checks_status(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.raise_for_status.return_value = None
    post_mock = mocker.patch("core.helper.marketplace.httpx.post", return_value=response)

    record_install_plugin_event("plugin.a")

    post_mock.assert_called_once()
    response.raise_for_status.assert_called_once()


def test_fetch_global_plugin_manifest_caches_each_plugin(mocker: MockerFixture) -> None:
    response = MagicMock()
    response.raise_for_status.return_value = None
    response.json.return_value = {"plugins": [{"id": "a"}, {"id": "b"}]}
    mocker.patch("core.helper.marketplace.httpx.get", return_value=response)

    snapshot_a = SimpleNamespace(plugin_id="plugin-a", model_dump_json=lambda: '{"id":"a"}')
    snapshot_b = SimpleNamespace(plugin_id="plugin-b", model_dump_json=lambda: '{"id":"b"}')
    validate_mock = mocker.patch(
        "core.helper.marketplace.MarketplacePluginSnapshot.model_validate",
        side_effect=[snapshot_a, snapshot_b],
    )
    setex_mock = mocker.patch("core.helper.marketplace.redis_client.setex")

    fetch_global_plugin_manifest("prefix:", 60)

    assert validate_mock.call_count == 2
    setex_mock.assert_any_call(name="prefix:plugin-a", time=60, value='{"id":"a"}')
    setex_mock.assert_any_call(name="prefix:plugin-b", time=60, value='{"id":"b"}')
