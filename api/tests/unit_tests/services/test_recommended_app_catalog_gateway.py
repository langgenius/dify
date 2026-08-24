import json
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest
import yaml

from services import recommended_app_catalog_gateway as gateway_module
from services.recommended_app_catalog_gateway import (
    BuiltinRecommendedAppCatalogGateway,
    RecommendedAppCatalogRouter,
    RemoteRecommendedAppCatalogGateway,
)
from services.recommended_app_query_service import (
    RecommendedAppCatalogPage,
    RecommendedAppDetailRecord,
    RecommendedAppInfoRecord,
    RecommendedAppRecord,
)


def _page_payload(*app_ids: str, learn_dify_ids: frozenset[str] = frozenset()) -> dict[str, object]:
    app_ids = app_ids or ("app-1",)
    return {
        "recommended_apps": [
            {
                "app": {
                    "id": app_id,
                    "name": "App",
                    "mode": "chat",
                    "icon": "icon.png",
                    "icon_type": "image",
                    "icon_background": "#fff",
                },
                "app_id": app_id,
                "description": "description",
                "copyright": None,
                "privacy_policy": None,
                "categories": ["Workflow"],
                "position": 1,
                "is_listed": True,
                **({"is_learn_dify": True} if app_id in learn_dify_ids else {}),
            }
            for app_id in app_ids
        ],
        "categories": ["Workflow"],
    }


def _detail_payload() -> dict[str, object]:
    return {
        "id": "app-1",
        "name": "App",
        "icon": None,
        "icon_background": None,
        "mode": "chat",
        "export_data": "{}",
    }


def _expected_page(*, categories: tuple[str, ...] = ("Workflow",)) -> RecommendedAppCatalogPage:
    return RecommendedAppCatalogPage(
        recommended_apps=(
            RecommendedAppRecord(
                app=RecommendedAppInfoRecord(
                    id="app-1",
                    name="App",
                    mode="chat",
                    icon="icon.png",
                    icon_type="image",
                    icon_background="#fff",
                ),
                app_id="app-1",
                description="description",
                copyright=None,
                privacy_policy=None,
                custom_disclaimer=None,
                categories=("Workflow",),
                position=1,
                is_listed=True,
            ),
        ),
        categories=categories,
    )


class TestBuiltinRecommendedAppCatalogGateway:
    def test_maps_bundled_catalog(self) -> None:
        gateway = BuiltinRecommendedAppCatalogGateway()
        page = gateway.list_recommended("en-US")
        learn_dify = gateway.list_learn_dify("ja-JP")
        detail = gateway.get_detail(page.recommended_apps[0].app_id)

        assert page.recommended_apps
        assert [app.app_id for app in learn_dify.recommended_apps] == [
            "f00c4531-6551-45ee-808f-1d7903099515",
            "d9f6b733-e35d-4a40-9f38-ca7bbfa009f7",
            "e9870913-dd01-4710-9f06-15d4180ca1ce",
        ]
        assert all(gateway.get_detail(app.app_id) is not None for app in learn_dify.recommended_apps)
        assert detail is not None

    def test_bundled_workflow_templates_have_unique_end_output_variables(self) -> None:
        data_path = Path(gateway_module.__file__).resolve().parents[1] / "constants" / "recommended_apps.json"
        data = json.loads(data_path.read_text(encoding="utf-8"))

        offenders: dict[str, list[str]] = {}
        for app_id, detail in data.get("app_details", {}).items():
            export_data = detail.get("export_data")
            if not export_data:
                continue
            dsl = yaml.safe_load(export_data)
            nodes = (dsl or {}).get("workflow", {}).get("graph", {}).get("nodes", [])
            output_names = [
                output.get("variable")
                for node in nodes
                if node.get("data", {}).get("type") == "end"
                for output in (node.get("data", {}).get("outputs") or [])
            ]
            duplicates = sorted({name for name in output_names if output_names.count(name) > 1})
            if duplicates:
                offenders[detail.get("name", app_id).strip()] = duplicates

        assert offenders == {}, f"templates with duplicate End output variable names: {offenders}"

    def test_maps_builtin_payload(self) -> None:
        gateway = BuiltinRecommendedAppCatalogGateway()
        gateway._data = {
            "recommended_apps": {"en-US": _page_payload("app-1", "app-2", learn_dify_ids=frozenset({"app-1"}))},
            "app_details": {"app-1": _detail_payload()},
        }

        assert [app.app_id for app in gateway.list_recommended("en-US").recommended_apps] == ["app-1", "app-2"]
        assert gateway.list_learn_dify("en-US") == RecommendedAppCatalogPage(
            recommended_apps=_expected_page().recommended_apps,
            categories=(),
        )
        assert gateway.get_detail("app-1") == RecommendedAppDetailRecord(
            id="app-1",
            name="App",
            icon=None,
            icon_background=None,
            mode="chat",
            export_data="{}",
        )

    def test_membership_uses_raw_non_none_detail(self) -> None:
        gateway = BuiltinRecommendedAppCatalogGateway()
        gateway._data = {"app_details": {"malformed": object()}}

        assert gateway.contains("malformed") is True
        assert gateway.contains("missing") is False
        with pytest.raises(TypeError, match="recommended app detail must be a mapping"):
            gateway.get_detail("malformed")

    def test_missing_language_returns_empty_page(self) -> None:
        gateway = BuiltinRecommendedAppCatalogGateway()
        gateway._data = {"recommended_apps": {}}

        assert gateway.list_recommended("fr-FR") == RecommendedAppCatalogPage(
            recommended_apps=(),
            categories=(),
        )
        assert gateway.list_learn_dify("fr-FR") == RecommendedAppCatalogPage(
            recommended_apps=(),
            categories=(),
        )

    def test_nonempty_page_requires_categories(self) -> None:
        page = _page_payload()
        del page["categories"]
        gateway = BuiltinRecommendedAppCatalogGateway()
        gateway._data = {"recommended_apps": {"en-US": page}}

        with pytest.raises(KeyError, match="categories"):
            gateway.list_recommended("en-US")

    @pytest.mark.parametrize("categories", ["Agent", b"Agent", ["Agent", 1]])
    def test_rejects_malformed_page_categories(self, categories: object) -> None:
        page = _page_payload()
        page["categories"] = categories
        gateway = BuiltinRecommendedAppCatalogGateway()
        gateway._data = {"recommended_apps": {"en-US": page}}

        with pytest.raises(TypeError, match="categories must"):
            gateway.list_recommended("en-US")

    def test_rejects_malformed_app_categories(self) -> None:
        gateway = BuiltinRecommendedAppCatalogGateway()
        gateway._data = {
            "recommended_apps": {
                "en-US": {
                    "recommended_apps": [{"app": None, "app_id": "app-1", "categories": "Agent"}],
                    "categories": ["Agent"],
                }
            }
        }

        with pytest.raises(TypeError, match="categories must"):
            gateway.list_recommended("en-US")

    def test_rejects_non_string_detail_mode(self) -> None:
        detail = _detail_payload()
        detail["mode"] = object()
        gateway = BuiltinRecommendedAppCatalogGateway()
        gateway._data = {"app_details": {"app-1": detail}}

        with pytest.raises(TypeError, match="mode must be a string"):
            gateway.get_detail("app-1")

    def test_reads_builtin_file_once_per_gateway(self) -> None:
        gateway = BuiltinRecommendedAppCatalogGateway()
        payload = json.dumps({"recommended_apps": {"en-US": _page_payload()}})

        with patch.object(gateway_module.Path, "read_text", return_value=payload) as read_text:
            gateway.list_recommended("en-US")
            gateway.list_recommended("en-US")

        read_text.assert_called_once_with(encoding="utf-8")


class TestRemoteRecommendedAppCatalogGateway:
    @pytest.fixture(autouse=True)
    def _use_remote_mode(self, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
        gateway_module.clear_remote_fetch_cache()
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "remote")
        yield
        gateway_module.clear_remote_fetch_cache()

    def test_maps_remote_pages_without_reordering(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gateway = RemoteRecommendedAppCatalogGateway()
        payload = _page_payload("app-2", "app-1")
        payload["categories"] = ["Writing", "Agent"]
        monkeypatch.setattr(gateway, "_fetch_page", MagicMock(return_value=payload))
        monkeypatch.setattr(gateway, "_fetch_learn_dify_page", MagicMock(return_value=payload))

        recommended = gateway.list_recommended("en-US")
        learn_dify = gateway.list_learn_dify("en-US")
        assert [app.app_id for app in recommended.recommended_apps] == ["app-2", "app-1"]
        assert recommended.categories == ("Writing", "Agent")
        assert [app.app_id for app in learn_dify.recommended_apps] == ["app-2", "app-1"]
        assert learn_dify.categories == ()

    def test_list_fetch_error_falls_back_through_builtin_en_us(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = MagicMock()
        empty_page = RecommendedAppCatalogPage(recommended_apps=(), categories=())
        fallback_page = _expected_page(categories=("builtin",))
        fallback.list_recommended.side_effect = [empty_page, fallback_page]
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=MagicMock(),
            builtin=fallback,
        )

        monkeypatch.setattr(remote, "_fetch_page", MagicMock(side_effect=ConnectionError("timeout")))

        assert router.list_recommended("fr-FR") == fallback_page
        assert fallback.list_recommended.call_args_list == [call("fr-FR"), call("en-US")]

    def test_json_decode_error_falls_back_to_builtin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = MagicMock()
        expected_page = _expected_page()
        fallback.list_recommended.return_value = expected_page
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=MagicMock(),
            builtin=fallback,
        )
        response = MagicMock(status_code=200)
        response.json.side_effect = ValueError("invalid JSON")
        monkeypatch.setattr(gateway_module.httpx, "get", MagicMock(return_value=response))

        assert router.list_recommended("en-US") == expected_page
        fallback.list_recommended.assert_called_once_with("en-US")

    def test_payload_mapping_error_does_not_fall_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = MagicMock()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=MagicMock(),
            builtin=fallback,
        )
        monkeypatch.setattr(remote, "_fetch_page", MagicMock(return_value=object()))

        with pytest.raises(TypeError, match="recommended app page must be a mapping"):
            router.list_recommended("en-US")
        fallback.list_recommended.assert_not_called()

    def test_learn_dify_fetch_error_falls_back_to_builtin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        builtin = MagicMock()
        database = MagicMock()
        page = RecommendedAppCatalogPage(recommended_apps=(), categories=())
        builtin.list_learn_dify.return_value = page
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=builtin,
        )

        monkeypatch.setattr(remote, "_fetch_learn_dify_page", MagicMock(side_effect=ConnectionError("timeout")))

        assert router.list_learn_dify("ja-JP") == page
        builtin.list_learn_dify.assert_called_once_with("ja-JP")
        database.list_learn_dify.assert_not_called()

    def test_empty_remote_learn_dify_page_does_not_fall_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        database = MagicMock()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=MagicMock(),
        )
        monkeypatch.setattr(
            remote,
            "_fetch_learn_dify_page",
            MagicMock(return_value={"recommended_apps": [], "categories": []}),
        )

        assert router.list_learn_dify("en-US") == RecommendedAppCatalogPage(
            recommended_apps=(),
            categories=(),
        )
        database.list_learn_dify.assert_not_called()

    @pytest.mark.parametrize("status_code", [404, 500])
    def test_detail_non_200_returns_none_without_builtin_fallback(
        self,
        monkeypatch: pytest.MonkeyPatch,
        status_code: int,
    ) -> None:
        fallback = MagicMock()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=MagicMock(),
            builtin=fallback,
        )
        response = MagicMock(status_code=status_code)
        monkeypatch.setattr("services.recommended_app_catalog_gateway.httpx.get", MagicMock(return_value=response))

        assert router.get_detail("missing") is None
        fallback.get_detail.assert_not_called()

    def test_detail_fetch_error_falls_back_to_builtin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = MagicMock()
        fallback_detail = RecommendedAppDetailRecord(
            id="fallback",
            name="Fallback",
            icon=None,
            icon_background=None,
            mode="chat",
            export_data="{}",
        )
        fallback.get_detail.return_value = fallback_detail
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=MagicMock(),
            builtin=fallback,
        )

        monkeypatch.setattr(remote, "_fetch_detail", MagicMock(side_effect=ConnectionError("timeout")))

        assert router.get_detail("app-1") == fallback_detail
        fallback.get_detail.assert_called_once_with("app-1")

    def test_detail_mapping_error_does_not_fall_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = MagicMock()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=MagicMock(),
            builtin=fallback,
        )
        monkeypatch.setattr(remote, "_fetch_detail", MagicMock(return_value=object()))

        with pytest.raises(TypeError, match="recommended app detail must be a mapping"):
            router.get_detail("app-1")
        fallback.get_detail.assert_not_called()

    def test_learn_dify_mapping_error_does_not_fall_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        database = MagicMock()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=MagicMock(),
        )
        monkeypatch.setattr(remote, "_fetch_learn_dify_page", MagicMock(return_value=object()))

        with pytest.raises(TypeError, match="Learn Dify app page must be a mapping"):
            router.list_learn_dify("en-US")
        database.list_learn_dify.assert_not_called()

    def test_membership_accepts_raw_non_none_payload(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gateway = RemoteRecommendedAppCatalogGateway()
        monkeypatch.setattr(gateway, "_fetch_detail", MagicMock(return_value=object()))

        assert gateway.contains("app-1") is True

    @pytest.mark.parametrize("status_code", [404, 500])
    def test_membership_non_200_does_not_fall_back(
        self,
        monkeypatch: pytest.MonkeyPatch,
        status_code: int,
    ) -> None:
        fallback = MagicMock()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=MagicMock(),
            builtin=fallback,
        )
        response = MagicMock(status_code=status_code)
        monkeypatch.setattr(gateway_module.httpx, "get", MagicMock(return_value=response))

        assert router.contains("missing") is False
        fallback.contains.assert_not_called()

    def test_membership_fetch_error_falls_back_to_builtin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = MagicMock()
        fallback.contains.return_value = True
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=MagicMock(),
            builtin=fallback,
        )
        monkeypatch.setattr(remote, "_fetch_detail", MagicMock(side_effect=ConnectionError("timeout")))

        assert router.contains("app-1") is True
        fallback.contains.assert_called_once_with("app-1")

    def test_remote_request_uses_configured_origin_and_timeouts(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        response = MagicMock(status_code=200)
        response.json.return_value = _detail_payload()
        http_get = MagicMock(return_value=response)
        monkeypatch.setattr(gateway_module.httpx, "get", http_get)
        monkeypatch.setattr(
            gateway_module.dify_config,
            "HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN",
            "https://catalog.example.com",
        )
        monkeypatch.setattr(gateway_module.dify_config, "CONSOLE_WEB_URL", "https://console.example.com")
        gateway = RemoteRecommendedAppCatalogGateway()
        gateway.get_detail("app-1")

        http_get.assert_called_once()
        call = http_get.call_args
        assert call.args == ("https://catalog.example.com/apps/app-1",)
        assert call.kwargs["headers"] == {"Origin": "https://console.example.com"}
        assert call.kwargs["timeout"].connect == 3.0
        assert call.kwargs["timeout"].read == 10.0

    def test_remote_request_uses_cache(self, monkeypatch: pytest.MonkeyPatch) -> None:
        response = MagicMock(status_code=200)
        response.json.return_value = _page_payload()
        http_get = MagicMock(return_value=response)
        monkeypatch.setattr(gateway_module.httpx, "get", http_get)
        monkeypatch.setattr(
            gateway_module.dify_config,
            "HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN",
            "https://catalog.example.com",
        )
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL", 600)
        gateway = RemoteRecommendedAppCatalogGateway()

        assert gateway.list_recommended("en-US") == _expected_page()
        assert gateway.list_recommended("en-US") == _expected_page()
        http_get.assert_called_once()

    def test_remote_request_does_not_cache_failed_responses(self, monkeypatch: pytest.MonkeyPatch) -> None:
        response = MagicMock(status_code=500)
        http_get = MagicMock(return_value=response)
        monkeypatch.setattr(gateway_module.httpx, "get", http_get)
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL", 600)
        expected_page = _expected_page()
        fallback = MagicMock()
        fallback.list_recommended.return_value = expected_page
        router = RecommendedAppCatalogRouter(
            remote=RemoteRecommendedAppCatalogGateway(),
            database=MagicMock(),
            builtin=fallback,
        )

        assert router.list_recommended("en-US") == expected_page
        assert router.list_recommended("en-US") == expected_page
        assert http_get.call_count == 2

    def test_remote_request_skips_cache_when_disabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        response = MagicMock(status_code=200)
        response.json.return_value = _page_payload()
        http_get = MagicMock(return_value=response)
        monkeypatch.setattr(gateway_module.httpx, "get", http_get)
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL", 0)
        gateway = RemoteRecommendedAppCatalogGateway()

        gateway.list_recommended("en-US")
        gateway.list_recommended("en-US")
        assert http_get.call_count == 2

    def test_remote_request_cache_isolated_by_configured_origin(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        response = MagicMock(status_code=200)
        response.json.return_value = _page_payload()
        http_get = MagicMock(return_value=response)
        monkeypatch.setattr(gateway_module.httpx, "get", http_get)
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL", 600)
        gateway = RemoteRecommendedAppCatalogGateway()
        monkeypatch.setattr(gateway_module.dify_config, "CONSOLE_WEB_URL", "https://cloud-a.example.com")
        gateway.list_recommended("en-US")
        monkeypatch.setattr(gateway_module.dify_config, "CONSOLE_WEB_URL", "https://cloud-b.example.com")
        gateway.list_recommended("en-US")

        assert http_get.call_count == 2

    @pytest.mark.parametrize(
        ("console_web_url", "expected_headers"),
        [
            ("saas.dify.dev", {"Origin": "saas.dify.dev"}),
            ("http://localhost:3000/console", {"Origin": "http://localhost:3000/console"}),
            ("", {}),
        ],
    )
    def test_remote_request_uses_console_web_url(
        self,
        monkeypatch: pytest.MonkeyPatch,
        console_web_url: str,
        expected_headers: dict[str, str],
    ) -> None:
        response = MagicMock(status_code=200)
        response.json.return_value = _detail_payload()
        http_get = MagicMock(return_value=response)
        monkeypatch.setattr(gateway_module.httpx, "get", http_get)
        monkeypatch.setattr(gateway_module.dify_config, "CONSOLE_WEB_URL", console_web_url)
        gateway = RemoteRecommendedAppCatalogGateway()
        gateway.get_detail("app-1")

        assert http_get.call_args.kwargs["headers"] == expected_headers

    @pytest.mark.parametrize(
        ("operation", "expected_url"),
        [
            ("recommended", "https://catalog.example.com/apps?language=ja-JP"),
            ("learn_dify", "https://catalog.example.com/apps/learn-dify?language=ja-JP"),
        ],
    )
    def test_remote_list_non_200_uses_expected_fallback(
        self,
        monkeypatch: pytest.MonkeyPatch,
        operation: str,
        expected_url: str,
    ) -> None:
        response = MagicMock(status_code=500)
        http_get = MagicMock(return_value=response)
        monkeypatch.setattr(gateway_module.httpx, "get", http_get)
        monkeypatch.setattr(
            gateway_module.dify_config,
            "HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN",
            "https://catalog.example.com",
        )
        fallback = MagicMock()
        database = MagicMock()
        expected_page = _expected_page()
        fallback.list_recommended.return_value = expected_page
        fallback.list_learn_dify.return_value = expected_page
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=fallback,
        )

        result = router.list_recommended("ja-JP") if operation == "recommended" else router.list_learn_dify("ja-JP")
        fallback_call = fallback.list_recommended if operation == "recommended" else fallback.list_learn_dify

        assert result == expected_page
        assert http_get.call_args.args == (expected_url,)
        fallback_call.assert_called_once_with("ja-JP")
        database.list_learn_dify.assert_not_called()


class TestRecommendedAppCatalogRouter:
    def test_empty_page_falls_back_to_builtin_en_us(self, monkeypatch: pytest.MonkeyPatch) -> None:
        remote = MagicMock()
        builtin = MagicMock()
        remote.list_recommended.return_value = RecommendedAppCatalogPage(recommended_apps=(), categories=())
        expected_page = _expected_page(categories=("builtin",))
        builtin.list_recommended.return_value = expected_page
        gateway = RecommendedAppCatalogRouter(
            remote=remote,
            database=MagicMock(),
            builtin=builtin,
        )
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "remote")

        assert gateway.list_recommended("ja-JP") == expected_page
        remote.list_recommended.assert_called_once_with("ja-JP")
        builtin.list_recommended.assert_called_once_with("en-US")

    def test_resolves_mode_for_every_operation(self, monkeypatch: pytest.MonkeyPatch) -> None:
        remote = MagicMock()
        database = MagicMock()
        builtin = MagicMock()
        gateway = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=builtin,
        )

        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "remote")
        gateway.list_recommended("en-US")
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "db")
        gateway.list_learn_dify("en-US")
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "builtin")
        gateway.get_detail("app-1")
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "remote")
        gateway.contains("app-1")

        remote.list_recommended.assert_called_once_with("en-US")
        database.list_learn_dify.assert_called_once_with("en-US")
        builtin.get_detail.assert_called_once_with("app-1")
        remote.contains.assert_called_once_with("app-1")

    def test_builtin_mode_reads_builtin_learn_dify(self, monkeypatch: pytest.MonkeyPatch) -> None:
        builtin = MagicMock()
        database = MagicMock()
        expected_page = RecommendedAppCatalogPage(recommended_apps=(), categories=())
        builtin.list_learn_dify.return_value = expected_page
        gateway = RecommendedAppCatalogRouter(
            remote=MagicMock(),
            database=database,
            builtin=builtin,
        )
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "builtin")

        assert gateway.list_learn_dify("en-US") == expected_page
        builtin.list_learn_dify.assert_called_once_with("en-US")
        database.list_learn_dify.assert_not_called()

    def test_rejects_invalid_mode(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gateway = RecommendedAppCatalogRouter(
            remote=MagicMock(),
            database=MagicMock(),
            builtin=MagicMock(),
        )
        monkeypatch.setattr(gateway_module.dify_config, "HOSTED_FETCH_APP_TEMPLATES_MODE", "invalid")

        with pytest.raises(ValueError, match="invalid fetch recommended apps mode: invalid"):
            gateway.list_recommended("en-US")
