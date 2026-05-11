from unittest.mock import MagicMock

from commands import reset_encrypt_key_pair
from commands import workspace as workspace_commands


def test_reset_encrypt_key_pair_skips_non_self_hosted(monkeypatch, capsys):
    monkeypatch.setattr(workspace_commands.dify_config, "EDITION", "CLOUD")

    reset_encrypt_key_pair.callback()

    captured = capsys.readouterr()
    assert "only for SELF_HOSTED" in captured.out


def test_reset_encrypt_key_pair_rotates_keys_and_removes_custom_provider_data(monkeypatch, capsys):
    monkeypatch.setattr(workspace_commands.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(workspace_commands, "generate_key_pair", lambda tenant_id: f"public-key-{tenant_id}")
    tenant = MagicMock()
    tenant.id = "tenant-1"
    session = MagicMock()
    session.scalars.return_value.all.return_value = [tenant]
    session_manager = MagicMock()
    session_manager.begin.return_value.__enter__.return_value = session
    monkeypatch.setattr(workspace_commands, "sessionmaker", lambda *args, **kwargs: session_manager)
    monkeypatch.setattr(workspace_commands, "db", MagicMock(engine=object()))

    reset_encrypt_key_pair.callback()

    assert tenant.encrypt_public_key == "public-key-tenant-1"
    assert session.execute.call_count == 2
    captured = capsys.readouterr()
    assert "tenant-1 has been reset" in captured.out


def test_reset_encrypt_key_pair_stops_when_workspace_record_is_missing(monkeypatch, capsys):
    monkeypatch.setattr(workspace_commands.dify_config, "EDITION", "SELF_HOSTED")
    session = MagicMock()
    session.scalars.return_value.all.return_value = [None]
    session_manager = MagicMock()
    session_manager.begin.return_value.__enter__.return_value = session
    monkeypatch.setattr(workspace_commands, "sessionmaker", lambda *args, **kwargs: session_manager)
    monkeypatch.setattr(workspace_commands, "db", MagicMock(engine=object()))

    reset_encrypt_key_pair.callback()

    session.execute.assert_not_called()
    captured = capsys.readouterr()
    assert "No workspaces found" in captured.out
