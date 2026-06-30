#!/usr/bin/env python3

import base64
import importlib.util
import sys
from pathlib import Path

from common.config_helper import ConfigHelper


def _load_setup_module(name: str):
    module_path = Path(__file__).parent / "setup" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"stress_test_{name}", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _load_stress_test_module(name: str):
    module_path = Path(__file__).parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"stress_test_{name}", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_config_helper_getters_read_state_sections(tmp_path):
    helper = ConfigHelper(base_dir=tmp_path)
    helper.write_state(
        {
            "auth": {"access_token": "console-token", "csrf_token": "csrf-token"},
            "app": {"app_id": "app-id"},
            "api_key": {"token": "app-token"},
        }
    )

    assert helper.get_token() == "console-token"
    assert helper.get_csrf_token() == "csrf-token"
    assert helper.get_app_id() == "app-id"
    assert helper.get_api_key() == "app-token"
    assert helper.console_auth_headers() == {
        "authorization": "Bearer console-token",
        "X-CSRF-Token": "csrf-token",
    }
    assert helper.console_auth_cookies() == {
        "locale": "en-US",
        "access_token": "console-token",
        "csrf_token": "csrf-token",
    }


def test_login_admin_encodes_password_like_web_client():
    login_admin = _load_setup_module("login_admin")

    encoded = login_admin.encode_sensitive_field("password123")

    assert encoded == base64.b64encode(b"password123").decode()


def test_setup_admin_reads_credentials_from_environment(monkeypatch):
    setup_admin = _load_setup_module("setup_admin")
    monkeypatch.setenv("STRESS_TEST_ADMIN_EMAIL", "real-admin@example.com")
    monkeypatch.setenv("STRESS_TEST_ADMIN_USERNAME", "real-admin")
    monkeypatch.setenv("STRESS_TEST_ADMIN_PASSWORD", "secret")

    assert setup_admin.build_admin_config() == {
        "email": "real-admin@example.com",
        "username": "real-admin",
        "password": "secret",
    }


def test_setup_all_reads_credentials_from_environment(monkeypatch):
    setup_all = _load_stress_test_module("setup_all")
    monkeypatch.setenv("STRESS_TEST_ADMIN_EMAIL", "real-admin@example.com")
    monkeypatch.setenv("STRESS_TEST_ADMIN_USERNAME", "real-admin")
    monkeypatch.setenv("STRESS_TEST_ADMIN_PASSWORD", "secret")

    assert setup_all.build_admin_config() == {
        "email": "real-admin@example.com",
        "username": "real-admin",
        "password": "secret",
    }


def test_setup_all_confirm_defaults_to_yes(monkeypatch):
    setup_all = _load_stress_test_module("setup_all")
    monkeypatch.setattr("builtins.input", lambda prompt: "")

    assert setup_all.confirm("Continue?") is True


def test_create_api_key_fails_without_app_id(tmp_path):
    create_api_key = _load_setup_module("create_api_key")
    create_api_key.config_helper.base_dir = tmp_path
    create_api_key.config_helper.write_state({"auth": {"access_token": "token"}})

    assert create_api_key.create_api_key() is False


def test_plugin_install_response_without_task_is_non_blocking():
    install_openai_plugin = _load_setup_module("install_openai_plugin")

    assert install_openai_plugin.is_non_blocking_install_response({"ok": True}) is True
    assert install_openai_plugin.is_non_blocking_install_response({}) is True
    assert (
        install_openai_plugin.is_non_blocking_install_response({"code": "plugin_error"})
        is False
    )


def test_import_response_with_warnings_and_app_id_is_success():
    import_workflow_app = _load_setup_module("import_workflow_app")

    assert import_workflow_app.is_successful_import_response(
        {"status": "completed-with-warnings", "app_id": "app-id"}
    )
    assert not import_workflow_app.is_successful_import_response(
        {"status": "failed", "app_id": "app-id"}
    )
    assert not import_workflow_app.is_successful_import_response(
        {"status": "completed"}
    )
