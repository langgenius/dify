import sys
import types
from unittest.mock import MagicMock

import commands
from configs import dify_config


def _install_fake_flask_migrate(monkeypatch, upgrade_impl) -> None:
    module = types.ModuleType("flask_migrate")
    module.upgrade = upgrade_impl
    monkeypatch.setitem(sys.modules, "flask_migrate", module)


def _invoke_upgrade_db() -> int:
    try:
        commands.upgrade_db.callback()
    except SystemExit as e:
        return int(e.code or 0)
    return 0


def test_upgrade_db_skips_when_lock_not_acquired(monkeypatch, capsys):
    monkeypatch.setattr(dify_config, "MIGRATION_LOCK_TTL", 1234)

    lock = MagicMock()
    lock.acquire.return_value = False
    commands.redis_client.lock.return_value = lock

    exit_code = _invoke_upgrade_db()
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "Database migration skipped" in captured.out

    commands.redis_client.lock.assert_called_once_with(name="db_upgrade_lock", timeout=1234)
    lock.acquire.assert_called_once_with(blocking=False)
    lock.release.assert_not_called()


def test_upgrade_db_failure_not_masked_by_lock_release(monkeypatch, capsys):
    monkeypatch.setattr(dify_config, "MIGRATION_LOCK_TTL", 321)

    lock = MagicMock()
    lock.acquire.return_value = True
    lock.release.side_effect = commands.LockNotOwnedError("simulated")
    commands.redis_client.lock.return_value = lock

    def _upgrade():
        raise RuntimeError("boom")

    _install_fake_flask_migrate(monkeypatch, _upgrade)

    exit_code = _invoke_upgrade_db()
    captured = capsys.readouterr()

    assert exit_code == 1
    assert "Database migration failed: boom" in captured.out

    commands.redis_client.lock.assert_called_once_with(name="db_upgrade_lock", timeout=321)
    lock.acquire.assert_called_once_with(blocking=False)
    lock.release.assert_called_once()


def test_upgrade_db_success_ignores_lock_not_owned_on_release(monkeypatch, capsys):
    monkeypatch.setattr(dify_config, "MIGRATION_LOCK_TTL", 999)

    lock = MagicMock()
    lock.acquire.return_value = True
    lock.release.side_effect = commands.LockNotOwnedError("simulated")
    commands.redis_client.lock.return_value = lock

    _install_fake_flask_migrate(monkeypatch, lambda: None)

    exit_code = _invoke_upgrade_db()
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "Database migration successful!" in captured.out

    commands.redis_client.lock.assert_called_once_with(name="db_upgrade_lock", timeout=999)
    lock.acquire.assert_called_once_with(blocking=False)
    lock.release.assert_called_once()

