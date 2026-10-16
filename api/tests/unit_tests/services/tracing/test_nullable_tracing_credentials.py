"""Nullable provider credentials never reach RSA/base64 as non-string tokens."""

from uuid import uuid4

import pytest
from Crypto.PublicKey import RSA
from pydantic import ValidationError
from sqlalchemy.orm import Session

import models.engine as model_engine
from core.ops.ops_trace_manager import OpsTraceManager
from extensions.ext_key_provider import key_provider_manager
from libs import gmpy2_pkcs10aep_cipher, rsa
from libs.key_providers.rsa_key_provider import RSAKeyProvider
from tests.unit_tests.model_factories import make_tenant


@pytest.fixture
def workspace(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> str:
    key = RSA.generate(2048)
    tenant_id = str(uuid4())
    sqlite_session.add(make_tenant(tenant_id=tenant_id, encrypt_public_key=key.publickey().export_key().decode()))
    sqlite_session.commit()
    monkeypatch.setattr(model_engine.db, "session", sqlite_session)
    monkeypatch.setattr(key_provider_manager, "_provider", RSAKeyProvider())
    monkeypatch.setattr(rsa, "get_decrypt_decoding", lambda _tenant: (key, gmpy2_pkcs10aep_cipher.new(key)))
    return tenant_id


def test_databricks_switches_auth_with_real_encryption_and_explicit_null(workspace: str) -> None:
    pat = OpsTraceManager.encrypt_tracing_config(
        workspace,
        "databricks",
        {
            "host": "https://workspace.test",
            "experiment_id": "12",
            "personal_access_token": "synthetic-pat",
            "client_id": None,
            "client_secret": None,
        },
    )
    assert pat["personal_access_token"] != "synthetic-pat"
    decrypted_pat = OpsTraceManager.decrypt_tracing_config(workspace, "databricks", pat)
    assert decrypted_pat["personal_access_token"] == "synthetic-pat"
    assert decrypted_pat["client_secret"] is None

    oauth = OpsTraceManager.encrypt_tracing_config(
        workspace,
        "databricks",
        {
            "host": "https://workspace.test",
            "experiment_id": "12",
            "personal_access_token": None,
            "client_id": "synthetic-client",
            "client_secret": "synthetic-secret",
        },
        pat,
    )
    assert oauth["personal_access_token"] is None
    assert oauth["client_secret"] != "synthetic-secret"
    decrypted_oauth = OpsTraceManager.decrypt_tracing_config(workspace, "databricks", oauth)
    assert decrypted_oauth["personal_access_token"] is None
    assert decrypted_oauth["client_secret"] == "synthetic-secret"


def test_other_optional_secret_model_can_be_cleared_without_losing_validation(workspace: str) -> None:
    password = OpsTraceManager.encrypt_tracing_config(
        workspace,
        "mlflow",
        {
            "tracking_uri": "https://mlflow.test",
            "experiment_id": "0",
            "username": "user",
            "password": "synthetic-password",
        },
    )
    assert OpsTraceManager.decrypt_tracing_config(workspace, "mlflow", password)["password"] == "synthetic-password"
    cleared = OpsTraceManager.encrypt_tracing_config(workspace, "mlflow", {**password, "password": None}, password)
    assert cleared["password"] is None
    assert OpsTraceManager.decrypt_tracing_config(workspace, "mlflow", cleared)["password"] is None


def test_non_nullable_secret_is_still_rejected_by_provider_model(workspace: str) -> None:
    with pytest.raises(ValidationError, match="secret_key"):
        OpsTraceManager.encrypt_tracing_config(
            workspace, "langfuse", {"public_key": "synthetic-public", "secret_key": None}
        )
    encrypted = OpsTraceManager.encrypt_tracing_config(
        workspace, "langfuse", {"public_key": "synthetic-public", "secret_key": "synthetic-secret"}
    )
    with pytest.raises(ValidationError, match="secret_key"):
        OpsTraceManager.decrypt_tracing_config(workspace, "langfuse", {**encrypted, "secret_key": None})
