"""Idempotent data migration for persisted Emoji Mart icon ids."""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa

from libs.emoji_normalization import (
    is_emoji_icon_type,
    legacy_emoji_map,
    normalize_icon_info_dict,
    normalize_legacy_emoji_value,
)


def _normalize_string_icon(icon_type: Any | None, icon: str | None) -> str | None:
    if icon is None:
        return None
    if not is_emoji_icon_type(icon_type):
        return icon
    return normalize_legacy_emoji_value(icon)


def _normalize_mcp_style_icon_blob(raw_icon: str) -> str | None:
    try:
        payload = json.loads(raw_icon)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    content = payload.get("content")
    if not isinstance(content, str):
        return None
    normalized = normalize_legacy_emoji_value(content)
    if normalized == content:
        return None
    payload["content"] = normalized
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def migrate_persisted_legacy_emoji_icons(connection: sa.Connection) -> None:
    legacy_keys = frozenset(legacy_emoji_map().keys())
    inspector = sa.inspect(connection)

    def _update_string_icon_rows(table: str, *, icon_type_column: str = "icon_type", icon_column: str = "icon") -> None:
        if not inspector.has_table(table):
            return
        rows = connection.execute(
            sa.text(
                f"SELECT id, {icon_type_column}, {icon_column} FROM {table} "
                f"WHERE {icon_column} IS NOT NULL AND {icon_type_column} = 'emoji'"
            )
        )
        for row_id, icon_type, icon in rows:
            if not isinstance(icon, str) or icon not in legacy_keys:
                continue
            normalized = _normalize_string_icon(icon_type, icon)
            if normalized is None or normalized == icon:
                continue
            connection.execute(
                sa.text(f"UPDATE {table} SET {icon_column} = :icon WHERE id = :row_id"),
                {"row_id": row_id, "icon": normalized},
            )

    for table in ("apps", "agents", "sites"):
        _update_string_icon_rows(table)

    if inspector.has_table("skills"):
        skill_rows = connection.execute(sa.text("SELECT id, icon FROM skills WHERE icon IS NOT NULL"))
        for row_id, icon in skill_rows:
            if not isinstance(icon, str) or icon not in legacy_keys:
                continue
            normalized = normalize_legacy_emoji_value(icon)
            if normalized == icon:
                continue
            connection.execute(
                sa.text("UPDATE skills SET icon = :icon WHERE id = :row_id"),
                {"row_id": row_id, "icon": normalized},
            )

    if inspector.has_table("datasets"):
        dataset_rows = connection.execute(sa.text("SELECT id, icon_info FROM datasets WHERE icon_info IS NOT NULL"))
        for row_id, icon_info in dataset_rows:
            if not isinstance(icon_info, dict):
                continue
            normalized_info = normalize_icon_info_dict(icon_info)
            if normalized_info == icon_info:
                continue
            connection.execute(
                sa.text("UPDATE datasets SET icon_info = :icon_info WHERE id = :row_id"),
                {"row_id": row_id, "icon_info": json.dumps(normalized_info, ensure_ascii=False)},
            )

    if inspector.has_table("customized_snippets"):
        snippet_rows = connection.execute(
            sa.text("SELECT id, icon_info FROM customized_snippets WHERE icon_info IS NOT NULL")
        )
        for row_id, icon_info in snippet_rows:
            if not isinstance(icon_info, dict):
                continue
            normalized_info = normalize_icon_info_dict(icon_info)
            if normalized_info == icon_info:
                continue
            connection.execute(
                sa.text("UPDATE customized_snippets SET icon_info = :icon_info WHERE id = :row_id"),
                {"row_id": row_id, "icon_info": json.dumps(normalized_info, ensure_ascii=False)},
            )

    for table in ("pipeline_customized_templates", "pipeline_built_in_templates"):
        if not inspector.has_table(table):
            continue
        template_rows = connection.execute(sa.text(f"SELECT id, icon FROM {table}"))
        for row_id, icon_info in template_rows:
            if not isinstance(icon_info, dict):
                continue
            normalized_info = normalize_icon_info_dict(icon_info)
            if normalized_info == icon_info:
                continue
            connection.execute(
                sa.text(f"UPDATE {table} SET icon = :icon WHERE id = :row_id"),
                {"row_id": row_id, "icon": json.dumps(normalized_info, ensure_ascii=False)},
            )

    if inspector.has_table("tool_mcp_providers"):
        mcp_rows = connection.execute(sa.text("SELECT id, icon FROM tool_mcp_providers WHERE icon IS NOT NULL"))
        for row_id, icon in mcp_rows:
            if not isinstance(icon, str):
                continue
            normalized_icon = _normalize_mcp_style_icon_blob(icon)
            if normalized_icon is None:
                continue
            connection.execute(
                sa.text("UPDATE tool_mcp_providers SET icon = :icon WHERE id = :row_id"),
                {"row_id": row_id, "icon": normalized_icon},
            )
