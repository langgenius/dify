from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from common.validation import (
    ParameterValidationError,
    boolean,
    choice,
    cookie_array,
    integer,
    json_object,
    nonblank_string,
    optional_integer,
    optional_string,
    reject_supplied,
    supplied,
    web_url,
)

GENERAL_SCHEMA_LABEL = "Return the output as JSON matching this schema:"
LISTING_SCHEMA_LABEL = "Return each item as JSON matching this schema:"

GENERAL_FIELDS = {
    "bypass_proxy",
    "html",
    "markdown",
    "render_javascript",
    "return_cookies",
    "screenshot",
    "use_home_page",
    "wait_for_selector",
}
LISTING_FIELDS = GENERAL_FIELDS | {"max_pages", "timeout", "stream"}
MAP_FIELDS = {"max_depth", "max_pages", "limit", "include_patterns", "exclude_patterns"}
MANUAL_FIELDS = {
    "bypass_proxy",
    "cookie_jar",
    "cookies",
    "home_page",
    "home_page_timeout",
    "html",
    "markdown",
    "paginator",
    "proxy",
    "record",
    "return_cookie",
    "screenshot",
    "stream",
    "timeout",
    "token_cap",
}


def compact_json(value: Mapping[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def append_output_schema(
    prompt: str | None, schema: Mapping[str, Any] | None, label: str
) -> str | None:
    if schema is None:
        return prompt
    block = f"{label}\n{compact_json(schema)}"
    if prompt and block in prompt:
        return prompt
    return f"{prompt}\n\n{block}" if prompt else block


def build_general_payload(parameters: Mapping[str, Any]) -> dict[str, Any]:
    prompt = optional_string(parameters.get("prompt"), "prompt")
    schema = json_object(parameters.get("output_schema"), "output_schema")
    payload: dict[str, Any] = {
        "graph": "general",
        "url": web_url(parameters.get("url")),
        "message": append_output_schema(prompt, schema, GENERAL_SCHEMA_LABEL),
        "mode": choice(parameters.get("mode"), "mode", {"Super", "Cheap"}, default="Super"),
        "proxyCountry": optional_string(parameters.get("proxy_country"), "proxy_country"),
    }
    return {key: value for key, value in payload.items() if value is not None}


def build_listing_payload(parameters: Mapping[str, Any]) -> dict[str, Any]:
    prompt = optional_string(parameters.get("prompt"), "prompt")
    schema = json_object(parameters.get("output_schema"), "output_schema")
    payload: dict[str, Any] = {
        "graph": "listing",
        "url": web_url(parameters.get("url")),
        "message": append_output_schema(prompt, schema, LISTING_SCHEMA_LABEL),
        "maxPages": integer(parameters.get("max_pages"), "max_pages", default=1, minimum=1),
        "proxyCountry": optional_string(parameters.get("proxy_country"), "proxy_country"),
    }
    return {key: value for key, value in payload.items() if value is not None}


def build_map_payload(parameters: Mapping[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "graph": "map",
        "url": web_url(parameters.get("url")),
        "maxDepth": integer(parameters.get("max_depth"), "max_depth", default=2),
        "maxPages": integer(parameters.get("max_pages"), "max_pages", default=50),
        "limit": integer(parameters.get("limit"), "limit", default=50, minimum=1),
        "includePatterns": optional_string(parameters.get("include_patterns"), "include_patterns"),
        "excludePatterns": optional_string(parameters.get("exclude_patterns"), "exclude_patterns"),
    }
    return {key: value for key, value in payload.items() if value is not None}


def build_rendered_request(
    parameters: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], int]:
    timeout = integer(parameters.get("timeout"), "timeout", default=300, minimum=1)
    screenshot = boolean(parameters.get("screenshot"), "screenshot", default=False)
    query: dict[str, Any] = {
        "browserRendering": "true",
        "timeout": timeout,
        "geoCode": optional_string(parameters.get("geo_code"), "geo_code") or "us",
        "proxyCountry": optional_string(parameters.get("proxy_country"), "proxy_country") or "us",
    }
    optional_query_booleans = {
        "html": ("html", True),
        "markdown": ("markdown", False),
        "block_resources": ("blockResources", False),
        "return_cookie": ("returnCookie", False),
        "super_mode": ("super", False),
    }
    for parameter_name, (payload_name, default) in optional_query_booleans.items():
        if boolean(parameters.get(parameter_name), parameter_name, default=default):
            query[payload_name] = "true"

    wait_for_selector = optional_string(parameters.get("wait_for_selector"), "wait_for_selector")
    if wait_for_selector:
        query["waitForSelector"] = wait_for_selector

    wait_until = optional_string(parameters.get("wait_until"), "wait_until")
    if wait_until:
        query["waitUntil"] = choice(
            wait_until,
            "wait_until",
            {"domcontentloaded", "load", "networkidle"},
        )

    if screenshot:
        query["screenshot"] = choice(
            optional_string(parameters.get("screenshot_mode"), "screenshot_mode") or "full",
            "screenshot_mode",
            {"full", "top"},
        )
    body: dict[str, Any] = {
        "url": web_url(parameters.get("url")),
        "maxRetries": integer(parameters.get("max_retries"), "max_retries", default=3, minimum=0),
    }
    token_cap = optional_integer(parameters.get("token_cap"), "token_cap", minimum=1)
    if token_cap is not None:
        body["tokenCap"] = token_cap
    if boolean(parameters.get("home_page"), "home_page", default=False):
        body["homePage"] = True
    return query, body, timeout


def _common_run_payload(parameters: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "scraperId": nonblank_string(parameters.get("scraper_id"), "scraper_id"),
        "url": web_url(parameters.get("url")),
        "maxRetry": integer(parameters.get("max_retry"), "max_retry", default=3, minimum=0),
        "proxyCountry": optional_string(parameters.get("proxy_country"), "proxy_country"),
    }


def _ai_general_values(parameters: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "bypassProxy": boolean(parameters.get("bypass_proxy"), "bypass_proxy", default=False),
        "html": boolean(parameters.get("html"), "html", default=False),
        "markdown": boolean(parameters.get("markdown"), "markdown", default=False),
        "renderJavascript": boolean(
            parameters.get("render_javascript"), "render_javascript", default=False
        ),
        "returnCookies": boolean(parameters.get("return_cookies"), "return_cookies", default=False),
        "screenshot": boolean(parameters.get("screenshot"), "screenshot", default=False),
        "useHomePage": boolean(parameters.get("use_home_page"), "use_home_page", default=False),
        "waitForSelector": optional_string(
            parameters.get("wait_for_selector"), "wait_for_selector"
        ),
    }


def build_existing_run(parameters: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
    scraper_type = choice(parameters.get("scraper_type"), "scraper_type", {"ai", "manual"})
    common = _common_run_payload(parameters)

    if scraper_type == "manual":
        if supplied(parameters, "agent_type"):
            raise ParameterValidationError("agent_type cannot be used with a manual scraper run.")
        reject_supplied(
            parameters,
            (GENERAL_FIELDS | LISTING_FIELDS | MAP_FIELDS) - MANUAL_FIELDS,
            "a manual scraper run",
        )
        payload = common | {
            "bypassProxy": boolean(parameters.get("bypass_proxy"), "bypass_proxy", default=True),
            "cookieJar": optional_string(parameters.get("cookie_jar"), "cookie_jar"),
            "cookies": cookie_array(parameters.get("cookies")),
            "homePage": boolean(parameters.get("home_page"), "home_page", default=False),
            "homePageTimeout": integer(
                parameters.get("home_page_timeout"), "home_page_timeout", default=10, minimum=1
            ),
            "html": boolean(parameters.get("html"), "html", default=False),
            "markdown": boolean(parameters.get("markdown"), "markdown", default=False),
            "paginator": json_object(parameters.get("paginator"), "paginator", default={}) or {},
            "proxy": optional_string(parameters.get("proxy"), "proxy"),
            "record": boolean(parameters.get("record"), "record", default=False),
            "returnCookie": boolean(
                parameters.get("return_cookie"), "return_cookie", default=False
            ),
            "screenshot": str(
                boolean(parameters.get("screenshot"), "screenshot", default=False)
            ).lower(),
            "stream": boolean(parameters.get("stream"), "stream", default=False),
            "timeout": integer(parameters.get("timeout"), "timeout", default=600, minimum=1),
            "tokenCap": integer(parameters.get("token_cap"), "token_cap", default=0, minimum=0),
        }
        return "/api/v1/scrapers-manual-rerun", {
            key: value for key, value in payload.items() if value is not None
        }

    reject_supplied(
        parameters,
        MANUAL_FIELDS - (GENERAL_FIELDS | LISTING_FIELDS),
        "an AI scraper run",
    )
    agent_type = choice(
        parameters.get("agent_type"),
        "agent_type",
        {"general", "listing", "map"},
        default="general",
    )
    if agent_type == "map":
        reject_supplied(
            parameters,
            (GENERAL_FIELDS | LISTING_FIELDS) - MAP_FIELDS,
            "a Map AI run",
        )
        payload = common | {
            "maxDepth": integer(parameters.get("max_depth"), "max_depth", default=2, minimum=0),
            "maxPages": integer(parameters.get("max_pages"), "max_pages", default=50, minimum=1),
            "limit": integer(parameters.get("limit"), "limit", default=50, minimum=1),
            "includePatterns": optional_string(
                parameters.get("include_patterns"), "include_patterns"
            ),
            "excludePatterns": optional_string(
                parameters.get("exclude_patterns"), "exclude_patterns"
            ),
        }
    elif agent_type == "general":
        reject_supplied(
            parameters,
            (LISTING_FIELDS | MAP_FIELDS) - GENERAL_FIELDS,
            "a General AI run",
        )
        payload = common | _ai_general_values(parameters)
    else:
        reject_supplied(parameters, MAP_FIELDS - LISTING_FIELDS, "a Listing AI run")
        payload = (
            common
            | _ai_general_values(parameters)
            | {
                "maxPages": integer(parameters.get("max_pages"), "max_pages", default=5, minimum=1),
                "timeout": integer(parameters.get("timeout"), "timeout", default=300, minimum=1),
                "stream": boolean(parameters.get("stream"), "stream", default=False),
            }
        )
    return "/api/v1/scrapers-ai-rerun", {
        key: value for key, value in payload.items() if value is not None
    }
