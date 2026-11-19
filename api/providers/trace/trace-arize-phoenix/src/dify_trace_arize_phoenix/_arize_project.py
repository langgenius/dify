"""The link to an Arize Cloud project: looked up by ``verify``, then built without I/O.

Arize Cloud addresses a project by organization, space, and project IDs, while
a configuration names it. The lookup runs only for the default Cloud collector,
so credentials for a custom or regional collector never reach an assumed API
host. It is optional: a key may ingest without read access, so every failure
means no link rather than a failed verification.
"""

import re
import time
from collections.abc import Mapping
from typing import TypeIs
from urllib.parse import quote, urlencode, urlsplit

from dify_trace_sdk.egress import Egress
from dify_trace_sdk.errors import EgressError

from dify_trace_arize_phoenix.config import ArizeConfig

API_BASE = "https://api.arize.com/v2"
UI_BASE = "https://app.arize.com"
CLOUD_COLLECTOR_HOST = "otlp.arize.com"
LOOKUP_BUDGET_SECONDS = 5.0
"""Shared by every lookup request, because a user waits for verification."""
MAX_RESPONSE_BYTES = 1024 * 1024
PAGE_LIMIT = 100
MAX_PAGES = 3
MAX_CURSOR_LENGTH = 4096
_OPAQUE_ID = re.compile(r"[A-Za-z0-9+/_=-]{1,1024}")


def _opaque_id(value: object) -> TypeIs[str]:
    # Never decode IDs (e.g. to derive an organization from a space) or accept URL metacharacters.
    return isinstance(value, str) and _OPAQUE_ID.fullmatch(value) is not None


def _cloud_collector(endpoint: str) -> bool:
    parsed = urlsplit(endpoint)
    try:
        port = parsed.port
    except ValueError:
        return False
    return parsed.scheme == "https" and parsed.hostname == CLOUD_COLLECTOR_HOST and port in {None, 443}


def _identity(config: ArizeConfig) -> dict[str, str] | None:
    """What a destination is bound to, or ``None`` when the collector is not the default Cloud one."""
    if not _cloud_collector(config.endpoint) or not _opaque_id(config.space_id):
        return None
    return {"endpoint": config.endpoint, "space_id": config.space_id, "project": config.project}


def project_url(config: ArizeConfig) -> str | None:
    """Built from the stored destination alone: presentation reads the space ID still encrypted.

    Verification resolves the destination again on every save, so a destination
    that names another endpoint or project only remains from a manual edit.
    """
    destination = config.arize_project_destination
    if destination is None or not _cloud_collector(config.endpoint):
        return None
    if destination.get("endpoint") != config.endpoint or destination.get("project") != config.project:
        return None
    organization_id, space_id, project_id = (
        destination.get("organization_id"),
        destination.get("space_id"),
        destination.get("project_id"),
    )
    if not _opaque_id(organization_id) or not _opaque_id(space_id) or not _opaque_id(project_id):
        return None
    return (
        f"{UI_BASE}/organizations/{quote(organization_id, safe='')}"
        f"/spaces/{quote(space_id, safe='')}/projects/{quote(project_id, safe='')}"
    )


def resolve_destination(egress: Egress, config: ArizeConfig) -> dict[str, str] | None:
    """Find the one project of the space named exactly ``config.project``.

    The API's name filter matches substrings, so up to ``MAX_PAGES`` pages are
    read for an exact match. Denied reads, malformed or ambiguous answers, and
    an exhausted budget all mean no destination.
    """
    identity = _identity(config)
    if identity is None:
        return None
    deadline = time.monotonic() + LOOKUP_BUDGET_SECONDS
    headers = {"Authorization": f"Bearer {config.api_key}", "Accept": "application/json"}

    def read(path: str) -> Mapping[str, object] | None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        try:
            # Every lookup URL embeds the space ID, which is a secret field.
            response = egress.request(
                "GET", API_BASE + path, headers=headers, content=None, timeout=remaining, sensitive_url=True
            )
        except EgressError:
            return None
        if response.status_code != 200 or len(response.content) > MAX_RESPONSE_BYTES or time.monotonic() > deadline:
            return None
        try:
            body = response.json()
        except (ValueError, RecursionError):
            return None
        return body if isinstance(body, dict) else None

    space = read(f"/spaces/{quote(config.space_id, safe='')}")
    organization_id = space.get("organization_id") if space is not None else None
    if space is None or space.get("id") != config.space_id or not _opaque_id(organization_id):
        return None
    project_ids: set[str] = set()
    seen_cursors: set[str] = set()
    query: dict[str, str | int] = {"space_id": config.space_id, "name": config.project, "limit": PAGE_LIMIT}
    for _ in range(MAX_PAGES):
        page = read("/projects?" + urlencode(query, quote_via=quote))
        projects = page.get("projects") if page is not None else None
        pagination = page.get("pagination") if page is not None else None
        if not isinstance(projects, list) or len(projects) > PAGE_LIMIT or not isinstance(pagination, dict):
            return None
        for project in projects:
            if not isinstance(project, dict) or project.get("space_id") != config.space_id:
                return None
            project_id, name = project.get("id"), project.get("name")
            if not _opaque_id(project_id) or not isinstance(name, str):
                return None
            if name == config.project:
                project_ids.add(project_id)
        if len(project_ids) > 1:
            return None
        has_more, cursor = pagination.get("has_more"), pagination.get("next_cursor")
        if has_more is False:
            if len(project_ids) != 1:
                return None
            return {**identity, "organization_id": organization_id, "project_id": project_ids.pop()}
        if (
            has_more is not True
            or not isinstance(cursor, str)
            or not 0 < len(cursor) <= MAX_CURSOR_LENGTH
            or cursor in seen_cursors
        ):
            return None
        seen_cursors.add(cursor)
        query["cursor"] = cursor
    return None
