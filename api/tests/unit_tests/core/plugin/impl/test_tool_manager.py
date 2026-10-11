from types import SimpleNamespace

import pytest
from pytest_mock import MockerFixture

from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.tool import PluginToolManager


def _tool_provider(name: str = "provider") -> SimpleNamespace:
    return SimpleNamespace(
        plugin_id="org/plugin",
        declaration=SimpleNamespace(
            identity=SimpleNamespace(name=name),
            tools=[SimpleNamespace(identity=SimpleNamespace(provider=""))],
        ),
    )


class TestPluginToolManager:
    def test_fetch_tool_providers(self, mocker: MockerFixture):
        manager = PluginToolManager()
        provider = _tool_provider("remote")
        mocker.patch("core.plugin.impl.tool.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": [
                    {
                        "declaration": {
                            "identity": {"name": "remote"},
                            "tools": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/x"}}],
                        }
                    }
                ]
            }
            transformed = transformer(payload)
            assert transformed["data"][0]["declaration"]["tools"][0]["output_schema"] == {"resolved": True}
            return [provider]

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_tool_providers("tenant-1")

        assert request_mock.call_count == 1
        assert result[0].declaration.identity.name == "org/plugin/remote"
        assert result[0].declaration.tools[0].identity.provider == "org/plugin/remote"

    def test_fetch_tool_provider(self, mocker: MockerFixture):
        manager = PluginToolManager()
        provider = _tool_provider("provider")
        mocker.patch("core.plugin.impl.tool.resolve_dify_schema_refs", return_value={"resolved": True})

        def fake_request(method, path, type_, **kwargs):
            transformer = kwargs["transformer"]
            payload = {
                "data": {
                    "declaration": {"tools": [{"identity": {"provider": "old"}, "output_schema": {"$ref": "#/x"}}]}
                }
            }
            transformed = transformer(payload)
            assert transformed["data"]["declaration"]["tools"][0]["output_schema"] == {"resolved": True}
            return provider

        request_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response", side_effect=fake_request)

        result = manager.fetch_tool_provider("tenant-1", "org/plugin/provider")

        assert request_mock.call_count == 1
        assert result.declaration.identity.name == "org/plugin/provider"
        assert result.declaration.tools[0].identity.provider == "org/plugin/provider"

    def test_invoke_merges_chunks(self, mocker: MockerFixture):
        manager = PluginToolManager()
        stream_mock = mocker.patch.object(
            manager, "_request_with_plugin_daemon_response_stream", return_value=iter(["chunk"])
        )
        merge_mock = mocker.patch("core.plugin.impl.tool.merge_blob_chunks", return_value=["merged"])

        result = manager.invoke(
            tenant_id="tenant-1",
            user_id="user-1",
            tool_provider="org/plugin/provider",
            tool_name="search",
            credentials={"api_key": "k"},
            credential_type=CredentialType.API_KEY,
            tool_parameters={"q": "python"},
            conversation_id="conv-1",
            app_id="app-1",
            message_id="msg-1",
        )

        assert result == ["merged"]
        assert merge_mock.call_count == 1
        assert stream_mock.call_args.kwargs["headers"]["X-Plugin-ID"] == "org/plugin"

    def test_validate_credentials_paths(self, mocker: MockerFixture):
        manager = PluginToolManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")

        stream_mock.return_value = iter([SimpleNamespace(result=True)])
        assert manager.validate_provider_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"}) is True

        stream_mock.return_value = iter([])
        assert manager.validate_provider_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"}) is False

        stream_mock.return_value = iter([SimpleNamespace(result=True)])
        assert manager.validate_datasource_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"}) is True

        stream_mock.return_value = iter([])
        assert manager.validate_datasource_credentials("tenant-1", "user-1", "org/plugin/provider", {"k": "v"}) is False

    def test_get_runtime_parameters_paths(self, mocker: MockerFixture):
        manager = PluginToolManager()
        stream_mock = mocker.patch.object(manager, "_request_with_plugin_daemon_response_stream")

        stream_mock.return_value = iter([SimpleNamespace(parameters=[{"name": "p"}])])
        params = manager.get_runtime_parameters("tenant-1", "user-1", "org/plugin/provider", {}, "search")
        assert params == [{"name": "p"}]

        stream_mock.return_value = iter([])
        params = manager.get_runtime_parameters("tenant-1", "user-1", "org/plugin/provider", {}, "search")
        assert params == []


# ---- ENG-1191: complete tenant tool inventory across daemon pages ------------
#
# The daemon's ListTools (dify-plugin-daemon internal/server/controllers/tool.go
# and internal/service/manage_plugin.go ListTools) accepts page >= 1 and
# page_size <= 256 and returns one tenant-filtered ``db.Page``; the response
# carries no total. Only the pooled HTTP client is faked here -- the real
# transformer and Pydantic provider entities run.


def _daemon(monkeypatch, **kwargs):
    from tests.unit_tests.services.dify_builder.installed_tool_inventory import FakeToolDaemon, install_fake_daemon

    return install_fake_daemon(monkeypatch, FakeToolDaemon(**kwargs))


def _providers(count: int, prefix: str = "p"):
    from tests.unit_tests.services.dify_builder.installed_tool_inventory import filler_providers

    return filler_providers(count, prefix=prefix)


def _ids(result) -> list[str]:
    return [provider.declaration.identity.name for provider in result]


class TestFetchToolProvidersPagination:
    def test_exactly_one_full_page_reads_the_empty_final_page(self, monkeypatch):
        daemon = _daemon(monkeypatch, providers_by_tenant={"tenant-1": _providers(256)})

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert len(result) == 256
        pages = daemon.list_tools_requests()
        assert [r.params["page"] for r in pages] == [1, 2]
        assert all(r.params["page_size"] == 256 for r in pages)

    def test_more_than_one_page_returns_every_provider_with_stable_ids(self, monkeypatch):
        daemon = _daemon(monkeypatch, providers_by_tenant={"tenant-1": _providers(300)})

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert len(result) == 300
        assert len(set(_ids(result))) == 300
        # the native stable id stays "<plugin_id>/<provider>", on tools too
        assert "aaa/p_299/p_299" in _ids(result)
        last = next(p for p in result if p.declaration.identity.name == "aaa/p_299/p_299")
        assert last.declaration.tools[0].identity.provider == "aaa/p_299/p_299"
        assert [r.params["page"] for r in daemon.list_tools_requests()] == [1, 2]

    def test_every_page_request_is_scoped_to_the_tenant(self, monkeypatch):
        daemon = _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": _providers(300), "tenant-2": _providers(3, prefix="other")},
        )

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert not any("other" in name for name in _ids(result))
        assert {r.path for r in daemon.list_tools_requests()} == {"/plugin/tenant-1/management/tools"}

    def test_a_failed_later_page_fails_the_fetch_instead_of_returning_a_partial_inventory(self, monkeypatch):
        _daemon(monkeypatch, providers_by_tenant={"tenant-1": _providers(300)}, fail_on_page=2)

        with pytest.raises(Exception):  # noqa: B017 -- any daemon failure, never a silent first page
            PluginToolManager().fetch_tool_providers("tenant-1")

    def test_duplicate_identities_across_pages_are_deduplicated(self, monkeypatch):
        page_one = _providers(256)
        # an unordered daemon page may repeat a row from the previous page
        tenant_rows = [*page_one, page_one[10], *_providers(5, prefix="tail")]
        _daemon(monkeypatch, providers_by_tenant={"tenant-1": tenant_rows})

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert len(result) == 261
        assert len(set(_ids(result))) == 261

    def test_a_daemon_that_repeats_the_same_full_page_fails_explicitly(self, monkeypatch):
        daemon = _daemon(monkeypatch, providers_by_tenant={"tenant-1": _providers(300)}, ignore_page=True)

        with pytest.raises(ValueError):
            PluginToolManager().fetch_tool_providers("tenant-1")
        assert len(daemon.list_tools_requests()) == 2

    def test_paging_is_bounded_and_fails_explicitly_rather_than_claiming_completeness(self, monkeypatch):
        daemon = _daemon(monkeypatch, endless_unique_pages=True, max_requests=200)

        with pytest.raises(ValueError):
            PluginToolManager().fetch_tool_providers("tenant-1")
        assert 2 <= len(daemon.list_tools_requests()) < 200


class TestFetchToolProvidersWithinPageDedup:
    """Stable-id dedup must also cover duplicates inside one daemon page."""

    def test_a_duplicate_inside_a_short_page_is_returned_once(self, monkeypatch):
        rows = _providers(5)
        _daemon(monkeypatch, providers_by_tenant={"tenant-1": [*rows, rows[2]]})

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert sorted(_ids(result)) == sorted(set(_ids(result)))
        assert len(result) == 5

    def test_a_duplicate_inside_a_full_page_is_returned_once(self, monkeypatch):
        rows = _providers(255)
        tail = _providers(3, prefix="tail")
        # page 1 is full (255 unique + 1 repeat); page 2 is short
        _daemon(monkeypatch, providers_by_tenant={"tenant-1": [*rows, rows[0], *tail]})

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert sorted(_ids(result)) == sorted(set(_ids(result)))
        assert len(result) == 258
