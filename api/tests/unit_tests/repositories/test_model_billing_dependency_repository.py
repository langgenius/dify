import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.model_billing_migration_protocol import canonical_hash
from graphon.model_runtime.entities.model_entities import ModelType
from models.account import Tenant
from models.provider import Provider, ProviderCredential, ProviderType, TenantDefaultModel, TenantPreferredModelProvider
from models.tokener import TenantTokenerIntegration
from repositories.model_billing_dependency_repository import ModelBillingDependencyRepository


def test_selection_facts_are_tenant_scoped_detached_readonly_and_do_not_select_encrypted_credentials(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> None:
    with sqlite_session_factory.begin() as session:
        for tenant, model in (("owned", "gpt-4o-mini"), ("other", "foreign")):
            session.add(
                Provider(
                    tenant_id=tenant,
                    provider_name="openai",
                    provider_type=ProviderType.CUSTOM,
                    credential_id="do-not-resolve",
                )
            )
            session.add(
                TenantPreferredModelProvider(
                    tenant_id=tenant, provider_name="openai", preferred_provider_type=ProviderType.CUSTOM
                )
            )
            session.add(
                TenantDefaultModel(tenant_id=tenant, provider_name="openai", model_name=model, model_type=ModelType.LLM)
            )
    statements: list[str] = []

    def record_statement(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement.lower())

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        repository = ModelBillingDependencyRepository(session_factory=sqlite_session_factory)
        result = repository.stored_selection_snapshot("owned")
        documents = repository.collect_model_dependency_documents("owned")
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)
    assert len(result.providers) == len(result.preferences) == len(result.defaults) == len(documents) == 1
    assert result.defaults[0].model == "gpt-4o-mini"
    assert all("encrypted_config" not in statement for statement in statements)
    assert all(statement.lstrip().startswith("select") for statement in statements)


@pytest.mark.parametrize("scope", ["owned", "foreign", "other-provider"])
def test_managed_target_attestation_only_exports_exact_owned_ciphertext_fingerprint(
    sqlite_session_factory: sessionmaker[Session],
    scope: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        tenant, other = Tenant(name="managed-readiness"), Tenant(name="foreign")
        session.add_all([tenant, other])
        session.flush()
        credential = ProviderCredential(
            tenant_id=other.id if scope == "foreign" else tenant.id,
            provider_name="other/provider/name" if scope == "other-provider" else "langgenius/tokener/tokener",
            credential_name="test",
            encrypted_config="ENCRYPTED_TEST_VALUE",
        )
        session.add(credential)
        session.flush()
        session.add(
            TenantTokenerIntegration(
                tenant_id=tenant.id,
                provider_credential_id=credential.id,
                plugin_unique_identifier="langgenius/tokener:1.0.0@" + "a" * 64,
            )
        )
    result = ModelBillingDependencyRepository(session_factory=sqlite_session_factory).managed_target_binding(tenant.id)
    if scope == "owned":
        assert result is not None
        assert result.credential_id == credential.id
        assert result.credential_fingerprint == canonical_hash({"encrypted_config": "ENCRYPTED_TEST_VALUE"})
        assert not hasattr(result, "encrypted_config")
    else:
        assert result is None
