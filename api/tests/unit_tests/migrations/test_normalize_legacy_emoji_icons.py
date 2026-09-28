from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import sqlalchemy as sa

from services.legacy_emoji_icon_migration import migrate_persisted_legacy_emoji_icons

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[3]
    / "migrations/versions/2026_09_20_1200-e7f3a2b8c901_normalize_legacy_emoji_icon_values.py"
)


def _load_migration_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("normalize_legacy_emoji_icons", _MIGRATION_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load migration module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_module_is_one_way() -> None:
    module = _load_migration_module()
    assert module.downgrade is not None
    module.downgrade()


def test_migrate_persisted_legacy_emoji_icons_is_idempotent() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(sa.text("CREATE TABLE apps (id TEXT PRIMARY KEY, icon_type TEXT, icon TEXT)"))
        connection.execute(
            sa.text("INSERT INTO apps (id, icon_type, icon) VALUES ('a1', 'emoji', 'rabbit'), ('a2', 'emoji', '🐰')")
        )
        migrate_persisted_legacy_emoji_icons(connection)
        first = connection.execute(sa.text("SELECT icon FROM apps WHERE id = 'a1'")).scalar_one()
        assert first == "🐰"
        migrate_persisted_legacy_emoji_icons(connection)
        second = connection.execute(sa.text("SELECT icon FROM apps WHERE id = 'a1'")).scalar_one()
        assert second == "🐰"
        unchanged = connection.execute(sa.text("SELECT icon FROM apps WHERE id = 'a2'")).scalar_one()
        assert unchanged == "🐰"
