from types import SimpleNamespace

import pytest
from pytest_mock import MockerFixture

from core.plugin.entities.plugin import PluginCategory
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.exc import PluginDaemonError
from core.plugin.impl.tool import PluginToolManager


def _tool_provider(name: str = "provider") -> SimpleNamespace:
    return SimpleNamespace(
        plugin_id="org/plugin",
        provider=name,
        plugin_unique_identifier=f"org/plugin:0.0.1@{'0' * 64}",
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
        # The installed Tool plugin ID list is the coverage authority; keep it
        # hermetic at its native owner.
        installed_ids = mocker.patch(
            "core.plugin.impl.tool.PluginInstaller.list_installed_plugin_ids", return_value=["org/plugin"]
        )

        result = manager.fetch_tool_providers("tenant-1")

        assert request_mock.call_count == 1
        assert {call.args for call in installed_ids.call_args_list} == {("tenant-1", PluginCategory.Tool)}
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

        with pytest.raises(PluginDaemonError, match="500|page failed"):
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

        with pytest.raises(ValueError, match="repeated tool provider page"):
            PluginToolManager().fetch_tool_providers("tenant-1")
        assert len(daemon.list_tools_requests()) == 2

    def test_paging_is_bounded_and_fails_explicitly_rather_than_claiming_completeness(self, monkeypatch):
        daemon = _daemon(monkeypatch, endless_unique_pages=True, max_requests=200)

        with pytest.raises(ValueError, match="full tool provider pages"):
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


# ---- ENG-1191 final review: authoritative installed-ID coverage -------------
#
# Native ListTools pages with OFFSET/LIMIT and no ORDER BY, so short-page
# termination plus dedup cannot prove completeness. The daemon's ordered,
# deduplicated ``installation/ids?category=tool`` list is the authority; IDs
# missing from the bulk pages are recovered through native installation
# batches (max 256) and the single-provider fetch. Only the pooled HTTP
# client is faked; the native HTTP owners and Pydantic entities run.


def _route_requests(daemon, route: str):
    return daemon.requests_for(route)


def _assert_metadata_only(daemon, tenant_id: str = "tenant-1") -> None:
    from tests.unit_tests.services.dify_builder.installed_tool_inventory import METADATA_ROUTES

    assert all(r.route in METADATA_ROUTES and r.tenant_id == tenant_id for r in daemon.requests)


def _batch_ids(daemon) -> list[list[str]]:
    from tests.unit_tests.services.dify_builder.installed_tool_inventory import INSTALLATION_BATCH

    return [list((r.body or {}).get("plugin_ids") or []) for r in daemon.requests_for(INSTALLATION_BATCH)]


def _single_ids(daemon) -> list[tuple[object, object]]:
    from tests.unit_tests.services.dify_builder.installed_tool_inventory import SINGLE_TOOL

    return [(r.params.get("plugin_id"), r.params.get("provider")) for r in daemon.requests_for(SINGLE_TOOL)]


def _installed_id_requests(daemon):
    from tests.unit_tests.services.dify_builder.installed_tool_inventory import INSTALLED_IDS

    return daemon.requests_for(INSTALLED_IDS)


_INVENTORY_FAILURES = (PluginDaemonError, ValueError)


class TestFetchToolProvidersAuthoritativeInventory:
    def test_legally_unordered_pages_recover_the_provider_bulk_omitted(self, monkeypatch):
        """The final review's unchanged 300-provider tenant: page 1 holds
        0..255, page 2 (another valid ordering) holds 255..298. Provider 299
        must come back through native metadata, never a silent 299."""
        rows = _providers(300)
        daemon = _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": rows},
            list_tools_pages={1: rows[:256], 2: rows[255:299]},
        )

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert sorted(_ids(result)) == sorted(f"aaa/p_{i:03d}/p_{i:03d}" for i in range(300))
        assert len(result) == 300
        recovered = next(p for p in result if p.declaration.identity.name == "aaa/p_299/p_299")
        # full stable ids and normalized actions, as on the bulk path
        assert recovered.plugin_id == "aaa/p_299"
        assert [tool.identity.provider for tool in recovered.declaration.tools] == ["aaa/p_299/p_299"]
        assert _batch_ids(daemon) == [["aaa/p_299"]]
        assert _single_ids(daemon) == [("aaa/p_299", "p_299")]
        _assert_metadata_only(daemon)

    def test_a_normal_inventory_reads_bulk_pages_and_never_fetches_providers_one_by_one(self, monkeypatch):
        daemon = _daemon(monkeypatch, providers_by_tenant={"tenant-1": _providers(300)})

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert len(result) == 300
        id_requests = _installed_id_requests(daemon)
        assert id_requests
        assert all(r.params.get("category") == "tool" for r in id_requests)
        assert _batch_ids(daemon) == []
        assert _single_ids(daemon) == []
        _assert_metadata_only(daemon)

    def test_an_empty_installed_id_list_yields_no_plugin_providers(self, monkeypatch):
        daemon = _daemon(monkeypatch, providers_by_tenant={})

        assert PluginToolManager().fetch_tool_providers("tenant-1") == []
        assert _installed_id_requests(daemon)
        assert _batch_ids(daemon) == []
        assert _single_ids(daemon) == []

    def test_duplicate_authoritative_ids_are_deduplicated(self, monkeypatch):
        rows = _providers(5)
        ids = [str(row["plugin_id"]) for row in rows]
        daemon = _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": rows},
            installed_ids_by_tenant={"tenant-1": [*ids, ids[4], ids[4]]},
            list_tools_pages={1: rows[:4]},
        )

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert sorted(_ids(result)) == sorted(set(_ids(result)))
        assert len(result) == 5
        assert _batch_ids(daemon) == [["aaa/p_004"]]
        assert _single_ids(daemon) == [("aaa/p_004", "p_004")]

    def test_recovery_batches_respect_the_native_256_id_limit(self, monkeypatch):
        rows = _providers(300)
        daemon = _daemon(monkeypatch, providers_by_tenant={"tenant-1": rows}, list_tools_pages={1: rows[:40]})

        result = PluginToolManager().fetch_tool_providers("tenant-1")

        assert len(result) == 300
        batches = _batch_ids(daemon)
        assert len(batches) >= 2
        assert all(1 <= len(batch) <= 256 for batch in batches)
        missing = {str(row["plugin_id"]) for row in rows[40:]}
        assert sorted(plugin_id for batch in batches for plugin_id in batch) == sorted(missing)
        assert sorted(plugin_id for plugin_id, _provider in _single_ids(daemon)) == sorted(missing)
        _assert_metadata_only(daemon)

    @pytest.mark.parametrize("defect", ["fail_routes", "malformed_routes"])
    def test_an_installed_id_lookup_failure_fails_the_fetch(self, monkeypatch, defect):
        from tests.unit_tests.services.dify_builder.installed_tool_inventory import INSTALLED_IDS

        _daemon(monkeypatch, providers_by_tenant={"tenant-1": _providers(3)}, **{defect: frozenset({INSTALLED_IDS})})

        with pytest.raises(_INVENTORY_FAILURES):
            PluginToolManager().fetch_tool_providers("tenant-1")

    @pytest.mark.parametrize(
        "corrupt",
        [
            pytest.param(lambda _rows, _ids: [], id="missing_row"),
            pytest.param(lambda rows, _ids: [*rows, *rows], id="duplicate_row"),
            pytest.param(
                lambda rows, _ids: [*rows, {**rows[0], "plugin_id": "aaa/p_000"}],
                id="extra_row",
            ),
            pytest.param(lambda rows, _ids: [{**rows[0], "tenant_id": "tenant-2"}], id="tenant_mismatch"),
            pytest.param(lambda rows, _ids: [{**rows[0], "plugin_id": "aaa/p_009"}], id="plugin_mismatch"),
            pytest.param(
                lambda rows, _ids: [{**rows[0], "plugin_unique_identifier": "aaa/p_004:9.9.9@" + "f" * 64}],
                id="unique_identifier_mismatch",
            ),
            pytest.param(
                lambda rows, _ids: [{**rows[0], "declaration": {**rows[0]["declaration"], "tool": None}}],
                id="absent_tool_manifest",
            ),
        ],
    )
    def test_a_defective_installation_batch_fails_the_fetch(self, monkeypatch, corrupt):
        rows = _providers(5)
        _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": rows},
            list_tools_pages={1: rows[:4]},
            batch_rows_hook=corrupt,
        )

        with pytest.raises(_INVENTORY_FAILURES):
            PluginToolManager().fetch_tool_providers("tenant-1")

    def _single_defect(self, monkeypatch, **kwargs):
        rows = _providers(5)
        return _daemon(monkeypatch, providers_by_tenant={"tenant-1": rows}, list_tools_pages={1: rows[:4]}, **kwargs)

    def test_a_failed_single_provider_fetch_fails_the_fetch(self, monkeypatch):
        from tests.unit_tests.services.dify_builder.installed_tool_inventory import SINGLE_TOOL

        self._single_defect(monkeypatch, fail_routes=frozenset({SINGLE_TOOL}))

        with pytest.raises(_INVENTORY_FAILURES):
            PluginToolManager().fetch_tool_providers("tenant-1")

    def test_an_unparsable_single_provider_fails_the_fetch(self, monkeypatch):
        from tests.unit_tests.services.dify_builder.installed_tool_inventory import SINGLE_TOOL

        self._single_defect(monkeypatch, malformed_routes=frozenset({SINGLE_TOOL}))

        with pytest.raises(_INVENTORY_FAILURES):
            PluginToolManager().fetch_tool_providers("tenant-1")

    @pytest.mark.parametrize(
        "mismatch",
        [
            pytest.param(lambda p: {**p, "plugin_id": "aaa/p_009"}, id="plugin_id"),
            pytest.param(
                lambda p: {**p, "plugin_unique_identifier": "aaa/p_004:9.9.9@" + "f" * 64},
                id="unique_identifier",
            ),
            pytest.param(
                lambda p: {
                    **p,
                    "declaration": {**p["declaration"], "identity": {**p["declaration"]["identity"], "name": "other"}},
                },
                id="provider_name",
            ),
        ],
    )
    def test_a_single_provider_identity_mismatch_fails_the_fetch(self, monkeypatch, mismatch):
        self._single_defect(monkeypatch, single_payload_hook=mismatch)

        with pytest.raises(_INVENTORY_FAILURES):
            PluginToolManager().fetch_tool_providers("tenant-1")

    def test_a_bulk_provider_that_is_not_installed_fails_the_fetch(self, monkeypatch):
        rows = _providers(5)
        _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": rows},
            installed_ids_by_tenant={"tenant-1": [str(row["plugin_id"]) for row in rows[:4]]},
        )

        with pytest.raises(ValueError, match="is not installed"):
            PluginToolManager().fetch_tool_providers("tenant-1")

    def test_an_installed_set_that_changes_during_the_fetch_fails(self, monkeypatch):
        rows = _providers(5)
        ids = [str(row["plugin_id"]) for row in rows]
        _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": rows},
            installed_ids_sequence=[list(ids), ids[:4]],
        )

        with pytest.raises(ValueError, match="installed tool plugins changed"):
            PluginToolManager().fetch_tool_providers("tenant-1")

    def test_an_installed_id_list_beyond_the_inventory_bound_fails_before_recovery(self, monkeypatch):
        oversized = [f"aaa/bulk_{index:05d}" for index in range(256 * 40 + 1)]
        daemon = _daemon(monkeypatch, providers_by_tenant={}, installed_ids_by_tenant={"tenant-1": oversized})

        with pytest.raises(ValueError, match="inventory bound exceeded"):
            PluginToolManager().fetch_tool_providers("tenant-1")
        assert _batch_ids(daemon) == []
        assert _single_ids(daemon) == []


class TestFetchToolProvidersRecoveryControls:
    """Gap controls added in GREEN: installation-batch failure, and the
    recovery path keeping the bulk path's output-schema resolution and
    normalized identities."""

    @pytest.mark.parametrize("defect", ["fail_routes", "malformed_routes"])
    def test_a_failed_installation_batch_fails_the_fetch(self, monkeypatch, defect):
        from tests.unit_tests.services.dify_builder.installed_tool_inventory import INSTALLATION_BATCH

        rows = _providers(5)
        _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": rows},
            list_tools_pages={1: rows[:4]},
            **{defect: frozenset({INSTALLATION_BATCH})},
        )

        with pytest.raises(_INVENTORY_FAILURES):
            PluginToolManager().fetch_tool_providers("tenant-1")

    def test_recovered_and_bulk_providers_resolve_output_schemas_alike(self, monkeypatch):
        rows = _providers(5)
        for row in rows:
            row["declaration"]["tools"][0]["output_schema"] = {"$ref": "#/definitions/x"}
        monkeypatch.setattr("core.plugin.impl.tool.resolve_dify_schema_refs", lambda _schema: {"resolved": True})
        _daemon(monkeypatch, providers_by_tenant={"tenant-1": rows}, list_tools_pages={1: rows[:4]})

        result = {p.declaration.identity.name: p for p in PluginToolManager().fetch_tool_providers("tenant-1")}

        assert len(result) == 5
        for name in ("aaa/p_000/p_000", "aaa/p_004/p_004"):  # bulk, recovered
            tool = result[name].declaration.tools[0]
            assert dict(tool.output_schema) == {"resolved": True}
            assert tool.identity.provider == name


def _foreign_unique_identifier(plugin_id: str = "aaa/p_009", version: str = "0.0.1") -> str:
    return f"{plugin_id}:{version}@{'e' * 64}"


class TestFetchToolProviderMetadataConsistency:
    """Public provider metadata must agree with itself and with the installed
    plugin identity; inconsistent rows fail instead of being dropped or
    trusted."""

    def test_two_bulk_rows_with_one_provider_id_but_different_unique_identifiers_fail(self, monkeypatch):
        rows = _providers(5)
        upgraded = {**rows[2], "plugin_unique_identifier": _foreign_unique_identifier("aaa/p_002", "0.0.2")}
        _daemon(monkeypatch, providers_by_tenant={"tenant-1": rows}, list_tools_pages={1: [*rows, upgraded]})

        with pytest.raises(ValueError, match="conflicting metadata"):
            PluginToolManager().fetch_tool_providers("tenant-1")

    def test_a_recovered_provider_whose_raw_provider_field_disagrees_fails(self, monkeypatch):
        rows = _providers(5)
        _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": rows},
            list_tools_pages={1: rows[:4]},
            single_payload_hook=lambda payload: {**payload, "provider": "other"},
        )

        with pytest.raises(ValueError, match="disagrees with its plugin id"):
            PluginToolManager().fetch_tool_providers("tenant-1")

    def test_a_bulk_unique_identifier_of_another_plugin_fails(self, monkeypatch):
        rows = _providers(5)
        foreign = {**rows[1], "plugin_unique_identifier": _foreign_unique_identifier()}
        _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": rows},
            list_tools_pages={1: [rows[0], foreign, *rows[2:]]},
        )

        with pytest.raises(ValueError, match="another plugin"):
            PluginToolManager().fetch_tool_providers("tenant-1")

    def test_installation_and_recovered_provider_agreeing_on_a_foreign_unique_identifier_fail(self, monkeypatch):
        rows = _providers(5)
        foreign = _foreign_unique_identifier()
        _daemon(
            monkeypatch,
            providers_by_tenant={"tenant-1": rows},
            list_tools_pages={1: rows[:4]},
            batch_rows_hook=lambda batch_rows, _ids: [
                {**row, "plugin_unique_identifier": foreign} for row in batch_rows
            ],
            single_payload_hook=lambda payload: {**payload, "plugin_unique_identifier": foreign},
        )

        with pytest.raises(ValueError, match="another plugin|metadata disagrees"):
            PluginToolManager().fetch_tool_providers("tenant-1")
