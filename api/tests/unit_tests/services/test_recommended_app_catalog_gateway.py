import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Never
from unittest.mock import patch

import httpx
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
    RecommendedAppCatalogQuery,
    RecommendedAppDetailRecord,
    RecommendedAppInfoRecord,
    RecommendedAppRecord,
)
from tests.unit_tests.config_override import apply_config_overrides


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


def test_agent_template_accepts_package_url_without_yaml() -> None:
    source = {**_detail_payload(), "mode": "agent", "package_url": "https://templates.example/agent.ifpkg"}
    source.pop("export_data")
    detail = gateway_module._map_detail(source)
    assert detail.package_url == "https://templates.example/agent.ifpkg"
    assert detail.export_data == ""


def test_non_agent_template_still_requires_yaml() -> None:
    source = _detail_payload()
    source.pop("export_data")
    with pytest.raises(KeyError):
        gateway_module._map_detail(source)


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


@dataclass
class RecordingCatalog(RecommendedAppCatalogQuery):
    recommended_pages: list[RecommendedAppCatalogPage] = field(default_factory=lambda: [_expected_page()])
    learn_dify_page: RecommendedAppCatalogPage = field(default_factory=_expected_page)
    detail: RecommendedAppDetailRecord | None = None
    member: bool = False
    calls: list[tuple[str, str]] = field(default_factory=list)

    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        self.calls.append(("recommended", language))
        return self.recommended_pages.pop(0) if len(self.recommended_pages) > 1 else self.recommended_pages[0]

    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        self.calls.append(("learn_dify", language))
        return self.learn_dify_page

    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        self.calls.append(("detail", app_id))
        return self.detail

    def contains(self, app_id: str) -> bool:
        self.calls.append(("contains", app_id))
        return self.member


def _fetch_timeout(_key: str) -> Never:
    raise ConnectionError("timeout")


def _install_http_get(
    monkeypatch: pytest.MonkeyPatch, response: httpx.Response
) -> list[tuple[str, dict[str, str], httpx.Timeout]]:
    requests: list[tuple[str, dict[str, str], httpx.Timeout]] = []

    def get(url: str, *, headers: dict[str, str], timeout: httpx.Timeout) -> httpx.Response:
        requests.append((url, headers, timeout))
        return response

    monkeypatch.setattr(gateway_module.httpx, "get", get)
    return requests


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
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="remote")
        yield
        gateway_module.clear_remote_fetch_cache()

    def test_maps_remote_pages_without_reordering(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gateway = RemoteRecommendedAppCatalogGateway()
        payload = _page_payload("app-2", "app-1")
        payload["categories"] = ["Writing", "Agent"]
        monkeypatch.setattr(gateway, "_fetch_page", lambda _language: payload)
        monkeypatch.setattr(gateway, "_fetch_learn_dify_page", lambda _language: payload)

        recommended = gateway.list_recommended("en-US")
        learn_dify = gateway.list_learn_dify("en-US")
        assert [app.app_id for app in recommended.recommended_apps] == ["app-2", "app-1"]
        assert recommended.categories == ("Writing", "Agent")
        assert [app.app_id for app in learn_dify.recommended_apps] == ["app-2", "app-1"]
        assert learn_dify.categories == ()

    def test_list_fetch_error_falls_back_through_builtin_en_us(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = RecordingCatalog()
        empty_page = RecommendedAppCatalogPage(recommended_apps=(), categories=())
        fallback_page = _expected_page(categories=("builtin",))
        fallback.recommended_pages = [empty_page, fallback_page]
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=RecordingCatalog(),
            builtin=fallback,
        )

        monkeypatch.setattr(remote, "_fetch_page", _fetch_timeout)

        assert router.list_recommended("fr-FR") == fallback_page
        assert fallback.calls == [("recommended", "fr-FR"), ("recommended", "en-US")]

    def test_json_decode_error_falls_back_to_builtin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = RecordingCatalog()
        expected_page = _expected_page()
        fallback.recommended_pages = [expected_page]
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=RecordingCatalog(),
            builtin=fallback,
        )
        response = httpx.Response(status_code=200, content=b"invalid JSON")
        _install_http_get(monkeypatch, response)

        assert router.list_recommended("en-US") == expected_page
        assert fallback.calls == [("recommended", "en-US")]

    def test_payload_mapping_error_does_not_fall_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = RecordingCatalog()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=RecordingCatalog(),
            builtin=fallback,
        )
        monkeypatch.setattr(remote, "_fetch_page", lambda _key: object())

        with pytest.raises(TypeError, match="recommended app page must be a mapping"):
            router.list_recommended("en-US")
        assert fallback.calls == []

    def test_learn_dify_fetch_error_falls_back_to_builtin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        builtin = RecordingCatalog()
        database = RecordingCatalog()
        page = RecommendedAppCatalogPage(recommended_apps=(), categories=())
        builtin.learn_dify_page = page
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=builtin,
        )

        monkeypatch.setattr(remote, "_fetch_learn_dify_page", _fetch_timeout)

        assert router.list_learn_dify("ja-JP") == page
        assert builtin.calls == [("learn_dify", "ja-JP")]
        assert database.calls == []

    def test_empty_remote_learn_dify_page_does_not_fall_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        database = RecordingCatalog()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=RecordingCatalog(),
        )
        monkeypatch.setattr(
            remote,
            "_fetch_learn_dify_page",
            lambda _language: {"recommended_apps": [], "categories": []},
        )

        assert router.list_learn_dify("en-US") == RecommendedAppCatalogPage(
            recommended_apps=(),
            categories=(),
        )
        assert database.calls == []

    @pytest.mark.parametrize("status_code", [404, 500])
    def test_detail_non_200_returns_none_without_builtin_fallback(
        self,
        monkeypatch: pytest.MonkeyPatch,
        status_code: int,
    ) -> None:
        fallback = RecordingCatalog()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=RecordingCatalog(),
            builtin=fallback,
        )
        response = httpx.Response(status_code=status_code)
        _install_http_get(monkeypatch, response)

        assert router.get_detail("missing") is None
        assert fallback.calls == []

    def test_detail_fetch_error_falls_back_to_builtin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = RecordingCatalog()
        fallback_detail = RecommendedAppDetailRecord(
            id="fallback",
            name="Fallback",
            icon=None,
            icon_background=None,
            mode="chat",
            export_data="{}",
        )
        fallback.detail = fallback_detail
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=RecordingCatalog(),
            builtin=fallback,
        )

        monkeypatch.setattr(remote, "_fetch_detail", _fetch_timeout)

        assert router.get_detail("app-1") == fallback_detail
        assert fallback.calls == [("detail", "app-1")]

    def test_detail_mapping_error_does_not_fall_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = RecordingCatalog()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=RecordingCatalog(),
            builtin=fallback,
        )
        monkeypatch.setattr(remote, "_fetch_detail", lambda _key: object())

        with pytest.raises(TypeError, match="recommended app detail must be a mapping"):
            router.get_detail("app-1")
        assert fallback.calls == []

    def test_learn_dify_mapping_error_does_not_fall_back(self, monkeypatch: pytest.MonkeyPatch) -> None:
        database = RecordingCatalog()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=RecordingCatalog(),
        )
        monkeypatch.setattr(remote, "_fetch_learn_dify_page", lambda _key: object())

        with pytest.raises(TypeError, match="Learn Dify app page must be a mapping"):
            router.list_learn_dify("en-US")
        assert database.calls == []

    def test_membership_accepts_raw_non_none_payload(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gateway = RemoteRecommendedAppCatalogGateway()
        monkeypatch.setattr(gateway, "_fetch_detail", lambda _key: object())

        assert gateway.contains("app-1") is True

    @pytest.mark.parametrize("status_code", [404, 500])
    def test_membership_non_200_does_not_fall_back(
        self,
        monkeypatch: pytest.MonkeyPatch,
        status_code: int,
    ) -> None:
        fallback = RecordingCatalog()
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=RecordingCatalog(),
            builtin=fallback,
        )
        response = httpx.Response(status_code=status_code)
        _install_http_get(monkeypatch, response)

        assert router.contains("missing") is False
        assert fallback.calls == []

    def test_membership_fetch_error_falls_back_to_builtin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fallback = RecordingCatalog()
        fallback.member = True
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=RecordingCatalog(),
            builtin=fallback,
        )
        monkeypatch.setattr(remote, "_fetch_detail", _fetch_timeout)

        assert router.contains("app-1") is True
        assert fallback.calls == [("contains", "app-1")]

    def test_remote_request_uses_configured_origin_and_timeouts(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        response = httpx.Response(status_code=200, json=_detail_payload())
        requests = _install_http_get(monkeypatch, response)
        apply_config_overrides(
            monkeypatch,
            HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN="https://catalog.example.com",
            CONSOLE_WEB_URL="https://console.example.com",
        )
        gateway = RemoteRecommendedAppCatalogGateway()
        gateway.get_detail("app-1")

        assert len(requests) == 1
        url, headers, timeout = requests[0]
        assert url == "https://catalog.example.com/apps/app-1"
        assert headers == {"Origin": "https://console.example.com"}
        assert timeout.connect == 3.0
        assert timeout.read == 10.0

    def test_remote_request_uses_cache(self, monkeypatch: pytest.MonkeyPatch) -> None:
        response = httpx.Response(status_code=200, json=_page_payload())
        requests = _install_http_get(monkeypatch, response)
        apply_config_overrides(
            monkeypatch,
            HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN="https://catalog.example.com",
            HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL=600,
        )
        gateway = RemoteRecommendedAppCatalogGateway()

        assert gateway.list_recommended("en-US") == _expected_page()
        assert gateway.list_recommended("en-US") == _expected_page()
        assert len(requests) == 1

    def test_remote_request_does_not_cache_failed_responses(self, monkeypatch: pytest.MonkeyPatch) -> None:
        response = httpx.Response(status_code=500)
        requests = _install_http_get(monkeypatch, response)
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL=600)
        expected_page = _expected_page()
        fallback = RecordingCatalog()
        fallback.recommended_pages = [expected_page]
        router = RecommendedAppCatalogRouter(
            remote=RemoteRecommendedAppCatalogGateway(),
            database=RecordingCatalog(),
            builtin=fallback,
        )

        assert router.list_recommended("en-US") == expected_page
        assert router.list_recommended("en-US") == expected_page
        assert len(requests) == 2

    def test_remote_request_skips_cache_when_disabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        response = httpx.Response(status_code=200, json=_page_payload())
        requests = _install_http_get(monkeypatch, response)
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL=0)
        gateway = RemoteRecommendedAppCatalogGateway()

        gateway.list_recommended("en-US")
        gateway.list_recommended("en-US")
        assert len(requests) == 2

    def test_remote_request_cache_isolated_by_configured_origin(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        response = httpx.Response(status_code=200, json=_page_payload())
        requests = _install_http_get(monkeypatch, response)
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_CACHE_TTL=600)
        gateway = RemoteRecommendedAppCatalogGateway()
        apply_config_overrides(monkeypatch, CONSOLE_WEB_URL="https://cloud-a.example.com")
        gateway.list_recommended("en-US")
        apply_config_overrides(monkeypatch, CONSOLE_WEB_URL="https://cloud-b.example.com")
        gateway.list_recommended("en-US")

        assert len(requests) == 2

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
        response = httpx.Response(status_code=200, json=_detail_payload())
        requests = _install_http_get(monkeypatch, response)
        apply_config_overrides(monkeypatch, CONSOLE_WEB_URL=console_web_url)
        gateway = RemoteRecommendedAppCatalogGateway()
        gateway.get_detail("app-1")

        assert requests[-1][1] == expected_headers

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
        response = httpx.Response(status_code=500)
        requests = _install_http_get(monkeypatch, response)
        apply_config_overrides(
            monkeypatch,
            HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN="https://catalog.example.com",
        )
        fallback = RecordingCatalog()
        database = RecordingCatalog()
        expected_page = _expected_page()
        fallback.recommended_pages = [expected_page]
        fallback.learn_dify_page = expected_page
        remote = RemoteRecommendedAppCatalogGateway()
        router = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=fallback,
        )

        result = router.list_recommended("ja-JP") if operation == "recommended" else router.list_learn_dify("ja-JP")

        assert result == expected_page
        assert requests[-1][0] == expected_url
        assert fallback.calls == [(operation, "ja-JP")]
        assert database.calls == []


class TestRecommendedAppCatalogRouter:
    def test_empty_page_falls_back_to_builtin_en_us(self, monkeypatch: pytest.MonkeyPatch) -> None:
        remote = RecordingCatalog()
        builtin = RecordingCatalog()
        remote.recommended_pages = [RecommendedAppCatalogPage(recommended_apps=(), categories=())]
        expected_page = _expected_page(categories=("builtin",))
        builtin.recommended_pages = [expected_page]
        gateway = RecommendedAppCatalogRouter(
            remote=remote,
            database=RecordingCatalog(),
            builtin=builtin,
        )
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="remote")

        assert gateway.list_recommended("ja-JP") == expected_page
        assert remote.calls == [("recommended", "ja-JP")]
        assert builtin.calls == [("recommended", "en-US")]

    def test_resolves_mode_for_every_operation(self, monkeypatch: pytest.MonkeyPatch) -> None:
        remote = RecordingCatalog()
        database = RecordingCatalog()
        builtin = RecordingCatalog()
        gateway = RecommendedAppCatalogRouter(
            remote=remote,
            database=database,
            builtin=builtin,
        )

        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="remote")
        gateway.list_recommended("en-US")
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="db")
        gateway.list_learn_dify("en-US")
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="builtin")
        gateway.get_detail("app-1")
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="remote")
        gateway.contains("app-1")

        assert remote.calls == [("recommended", "en-US"), ("contains", "app-1")]
        assert database.calls == [("learn_dify", "en-US")]
        assert builtin.calls == [("detail", "app-1")]

    def test_builtin_mode_reads_builtin_learn_dify(self, monkeypatch: pytest.MonkeyPatch) -> None:
        builtin = RecordingCatalog()
        database = RecordingCatalog()
        expected_page = RecommendedAppCatalogPage(recommended_apps=(), categories=())
        builtin.learn_dify_page = expected_page
        gateway = RecommendedAppCatalogRouter(
            remote=RecordingCatalog(),
            database=database,
            builtin=builtin,
        )
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="builtin")

        assert gateway.list_learn_dify("en-US") == expected_page
        assert builtin.calls == [("learn_dify", "en-US")]
        assert database.calls == []

    def test_rejects_invalid_mode(self, monkeypatch: pytest.MonkeyPatch) -> None:
        gateway = RecommendedAppCatalogRouter(
            remote=RecordingCatalog(),
            database=RecordingCatalog(),
            builtin=RecordingCatalog(),
        )
        apply_config_overrides(monkeypatch, HOSTED_FETCH_APP_TEMPLATES_MODE="invalid")

        with pytest.raises(ValueError, match="invalid fetch recommended apps mode: invalid"):
            gateway.list_recommended("en-US")
