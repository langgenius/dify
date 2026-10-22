"""Arize metadata reads are optional, bounded and pinned to the exact destination."""

from collections import deque
from collections.abc import Iterator
from typing import Never

import httpx
import pytest
from dify_trace_arize_phoenix import arize_configuration as configuration
from dify_trace_arize_phoenix.arize_configuration import (
    DESTINATION_KEY,
    bind_destination,
    project_url,
    resolve_project_destination,
)

from core.helper import ssrf_proxy

SPACE = "U3BhY2U6dGVzdA=="
ORG = "T3JnOnRlc3Q="
PROJECT = "UHJvamVjdDovKz0="
VALUES = {"endpoint": "https://otlp.arize.com", "space_id": SPACE, "project": "exact", "api_key": "synthetic-key"}
DESTINATION = {
    "endpoint": VALUES["endpoint"],
    "space_id": SPACE,
    "project": "exact",
    "organization_id": ORG,
    "project_id": PROJECT,
}
URL = "https://app.arize.com/organizations/T3JnOnRlc3Q%3D/spaces/U3BhY2U6dGVzdA%3D%3D/projects/UHJvamVjdDovKz0%3D"


def response(body: object, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("GET", "https://api.arize.com/v2/projects"))


def space() -> httpx.Response:
    return response({"id": SPACE, "organization_id": ORG})


def page(*projects: dict[str, str], more: bool = False, cursor: str | None = None) -> httpx.Response:
    return response({"projects": list(projects), "pagination": {"has_more": more, "next_cursor": cursor}})


def project(name: str = "exact", project_id: str = PROJECT) -> dict[str, str]:
    return {"id": project_id, "name": name, "space_id": SPACE}


@pytest.fixture
def responses() -> deque[httpx.Response | Exception]:
    return deque()


@pytest.fixture
def calls(
    monkeypatch: pytest.MonkeyPatch, responses: deque[httpx.Response | Exception]
) -> list[tuple[str, dict[str, object]]]:
    calls: list[tuple[str, dict[str, object]]] = []

    def get(url: str, **options: object) -> httpx.Response:
        calls.append((url, options))
        assert responses, "Unplanned metadata request"
        item = responses.popleft()
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(ssrf_proxy, "get", get)
    return calls


def test_exact_scoped_project_and_opaque_ids_use_official_route(
    calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception]
) -> None:
    received = [space(), page(project("exact-substring"), more=True, cursor="next"), page(project())]
    responses.extend(received)
    assert resolve_project_destination(VALUES) == DESTINATION
    assert (
        project_url(
            {**VALUES, DESTINATION_KEY: bind_destination(VALUES, DESTINATION), "project_url": "https://untrusted.test"}
        )
        == URL
    )
    assert len(calls) == 3
    assert calls[0][0] == "https://api.arize.com/v2/spaces/U3BhY2U6dGVzdA%3D%3D"
    assert calls[1][1]["params"] == {"space_id": SPACE, "name": "exact", "limit": 100}
    assert calls[2][1]["params"] == {"space_id": SPACE, "name": "exact", "limit": 100, "cursor": "next"}
    for url, options in calls:
        assert url.startswith("https://api.arize.com/v2/")
        assert options["headers"] == {
            "Authorization": "Bearer synthetic-key",
            "Accept": "application/json",
            "Accept-Encoding": "identity",
            "Cookie": "",
        }
        assert options["auth"] is None
        assert options["follow_redirects"] is False
        assert options["max_retries"] == 0
        assert options["stream_response"] is True
        timeout = options["timeout"]
        assert isinstance(timeout, float)
        assert 0 < timeout <= 5
    assert all(item.is_closed for item in received)


@pytest.mark.parametrize("status", [301, 401, 403, 404, 429, 500])
def test_unreadable_metadata_has_no_link_and_closes_response(
    calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception], status: int
) -> None:
    denied = response({"error": "private-response"}, status)
    responses.append(denied)
    assert resolve_project_destination(VALUES) is None
    assert len(calls) == 1
    assert denied.is_closed


@pytest.mark.parametrize(
    "body", [{"id": SPACE}, {"id": "other", "organization_id": ORG}, {"id": SPACE, "organization_id": "../bad"}]
)
def test_missing_or_mismatched_space_metadata_is_not_a_project(
    calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception], body: dict[str, str]
) -> None:
    responses.append(response(body))
    assert resolve_project_destination(VALUES) is None
    assert len(calls) == 1


@pytest.mark.parametrize(
    "body",
    [
        {"projects": [project("EXACT")], "pagination": {"has_more": False}},
        {"projects": [project(), project(project_id="other")], "pagination": {"has_more": False}},
        {"projects": [{**project(), "space_id": "other"}], "pagination": {"has_more": False}},
        {"projects": [{**project(), "id": "../bad"}], "pagination": {"has_more": False}},
        {"projects": [project()] * 101, "pagination": {"has_more": False}},
        {"projects": [project()], "pagination": {"has_more": True}},
        {"projects": [project()], "pagination": {"has_more": "false"}},
        {"projects": [project()]},
        {"data": [project()], "pagination": {"has_more": False}},
    ],
)
def test_incomplete_ambiguous_or_non_exact_projects_do_not_fabricate_links(
    calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception], body: object
) -> None:
    responses.extend([space(), response(body)])
    assert resolve_project_destination(VALUES) is None
    assert len(calls) == 2


@pytest.mark.parametrize("repeat", [False, True])
def test_pagination_is_bounded_and_never_accepts_a_partial_match(
    calls: list[tuple[str, dict[str, object]]], responses: deque[httpx.Response | Exception], repeat: bool
) -> None:
    responses.append(space())
    responses.extend(page(project(), more=True, cursor="same" if repeat else str(index)) for index in range(3))
    assert resolve_project_destination(VALUES) is None
    assert len(calls) == (3 if repeat else 4)


@pytest.mark.parametrize(
    "item",
    [
        httpx.ReadTimeout("synthetic-timeout"),
        httpx.Response(200, content=b"not-json"),
        httpx.Response(200, json=[]),
        httpx.Response(200, content=b" " * (1024 * 1024 + 1)),
        httpx.Response(200, json={}, headers={"content-encoding": "unsupported"}),
    ],
)
def test_transport_and_bounded_decode_failures_remain_optional(
    calls: list[tuple[str, dict[str, object]]],
    responses: deque[httpx.Response | Exception],
    item: httpx.Response | Exception,
) -> None:
    responses.append(item)
    assert resolve_project_destination(VALUES) is None
    assert len(calls) == 1
    if isinstance(item, httpx.Response):
        assert item.is_closed


def test_all_pages_share_one_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [100.0]
    calls: list[float] = []
    received = [space(), page(project(), more=True, cursor="next")]

    def get(_url: str, **options: object) -> httpx.Response:
        timeout = options["timeout"]
        assert isinstance(timeout, float)
        calls.append(timeout)
        clock[0] += 2.5
        return received[len(calls) - 1]

    monkeypatch.setattr(configuration.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(ssrf_proxy, "get", get)
    assert resolve_project_destination(VALUES) is None
    assert calls == [5.0, 2.5]
    assert all(item.is_closed for item in received)


def test_slow_response_chunks_stop_at_the_shared_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [100.0]
    chunks: list[int] = []
    received = httpx.Response(200)

    def stream() -> Iterator[bytes]:
        for index in range(10):
            clock[0] += 2.0
            chunks.append(index)
            yield b" "

    monkeypatch.setattr(configuration.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(received, "iter_bytes", stream)
    monkeypatch.setattr(ssrf_proxy, "get", lambda _url, **_options: received)
    assert resolve_project_destination(VALUES) is None
    assert chunks == [0, 1, 2]
    assert received.is_closed


@pytest.mark.parametrize(
    "change",
    [
        {"endpoint": "https://custom.test"},
        {"endpoint": "https://otlp.eu-west-1a.arize.com"},
        {"endpoint": "http://otlp.arize.com"},
        {"endpoint": "https://user:secret@otlp.arize.com"},
        {"endpoint": "https://otlp.arize.com:444"},
        {"space_id": "../bad"},
        {"api_key": None},
        {"api_key": ""},
        {"api_key": "******"},
        {"api_key": "key\nheader"},
    ],
)
def test_unsupported_destination_or_credentials_do_not_send_to_an_assumed_host(
    calls: list[tuple[str, dict[str, object]]], change: dict[str, str | None]
) -> None:
    assert resolve_project_destination({**VALUES, **change}) is None
    assert calls == []


@pytest.mark.parametrize(
    "change",
    [
        {"endpoint": "https://otlp.arize.com:443"},
        {"space_id": "other"},
        {"project": "later"},
        {DESTINATION_KEY: {**DESTINATION, "organization_id": "bad?query"}},
        {DESTINATION_KEY: {**DESTINATION, "project_id": "../bad"}},
        {DESTINATION_KEY: None},
    ],
)
def test_get_formatter_rejects_stale_or_forged_metadata_without_io(
    monkeypatch: pytest.MonkeyPatch, change: dict[str, object]
) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> Never:
        raise AssertionError("GET must not call the vendor")

    monkeypatch.setattr(ssrf_proxy, "get", forbidden)
    assert project_url({**VALUES, DESTINATION_KEY: bind_destination(VALUES, DESTINATION), **change}) is None
