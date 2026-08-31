from common.payloads import build_existing_run, build_rendered_request


def test_rendered_request_omits_false_and_empty_optional_parameters() -> None:
    query, body, timeout = build_rendered_request(
        {
            "url": "https://example.com/page",
            "screenshot": False,
            "screenshot_mode": "full",
            "html": False,
            "markdown": False,
            "token_cap": "",
            "wait_for_selector": "",
            "wait_until": "",
            "block_resources": False,
            "home_page": False,
            "return_cookie": False,
            "super_mode": False,
        }
    )

    assert query == {
        "browserRendering": "true",
        "timeout": 300,
        "geoCode": "us",
        "proxyCountry": "us",
    }
    assert body == {"url": "https://example.com/page", "maxRetries": 3}
    assert timeout == 300


def test_rendered_request_sends_enabled_optional_parameters() -> None:
    query, body, _ = build_rendered_request(
        {
            "url": "https://example.com",
            "screenshot": True,
            "screenshot_mode": "top",
            "html": True,
            "wait_until": "networkidle",
            "home_page": True,
            "token_cap": 20,
        }
    )

    assert query["screenshot"] == "top"
    assert query["html"] == "true"
    assert query["waitUntil"] == "networkidle"
    assert body["homePage"] is True
    assert body["tokenCap"] == 20


def test_rendered_request_returns_html_by_default() -> None:
    query, _, _ = build_rendered_request({"url": "https://example.com"})

    assert query["html"] == "true"


def test_existing_ai_agent_types_build_distinct_payloads() -> None:
    common = {"scraper_type": "ai", "scraper_id": "scraper-1", "url": "https://example.com"}

    _, general = build_existing_run(common | {"agent_type": "general"})
    _, listing = build_existing_run(common | {"agent_type": "listing"})
    _, map_payload = build_existing_run(common | {"agent_type": "map"})

    assert "maxPages" not in general
    assert listing["maxPages"] == 5
    assert map_payload["maxDepth"] == 2
    assert "html" not in map_payload


def test_existing_manual_run_parses_json_text_fields() -> None:
    path, payload = build_existing_run(
        {
            "scraper_type": "manual",
            "scraper_id": "scraper-1",
            "url": "https://example.com",
            "cookies": '[{"name":"session","value":"token"}]',
            "paginator": '{"nextSelector":"a.next"}',
        }
    )

    assert path == "/api/v1/scrapers-manual-rerun"
    assert payload["cookies"] == [{"name": "session", "value": "token"}]
    assert payload["paginator"] == {"nextSelector": "a.next"}
