"""Policy CAS, membership and tenant isolation through real SQL sessions."""

from collections.abc import Iterator
from typing import cast

import pytest
from sqlalchemy import Table, create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.models import Actor
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.dify_builder_cognition_policy import DifyBuilderCognitionPolicy
from services.dify_builder.application.cognition_policy import (
    CognitionModel,
    CognitionPolicy,
    CognitionPolicyDeniedError,
)
from services.dify_builder.repository import SqlDifyBuilderRepository

ACTOR = Actor(tenant_id="11111111-1111-1111-1111-111111111111", account_id="22222222-2222-2222-2222-222222222222")
POLICY = CognitionPolicy(True, (CognitionModel("one", "openai", "gpt", "chat", {}),), "one", (), 0, "explicit")


type SqlContext = tuple[SqlDifyBuilderRepository, sessionmaker[Session]]


@pytest.fixture
def sql() -> Iterator[SqlContext]:
    engine = create_engine("sqlite://")
    for table in (Tenant.__table__, TenantAccountJoin.__table__, DifyBuilderCognitionPolicy.__table__):
        cast(Table, table).create(engine)
    factory = sessionmaker(bind=engine)
    with factory() as session, session.begin():
        tenant = Tenant(name="test", custom_config='{"branding":"preserved"}')
        tenant.id = ACTOR.tenant_id
        session.add(tenant)
        session.add(
            TenantAccountJoin(tenant_id=ACTOR.tenant_id, account_id=ACTOR.account_id, role=TenantAccountRole.ADMIN)
        )
    yield SqlDifyBuilderRepository(factory), factory
    engine.dispose()


def test_first_write_then_stale_revision_and_branding(sql: SqlContext) -> None:
    repo, factory = sql
    assert repo.get_policy(ACTOR) is None
    assert repo.put_policy(ACTOR, POLICY, 0).revision == 1
    with pytest.raises(CognitionPolicyDeniedError, match="policy_revision_conflict"):
        repo.put_policy(ACTOR, POLICY, 0)
    assert repo.put_policy(ACTOR, POLICY, 1).revision == 2
    with factory() as session:
        tenant = session.get(Tenant, ACTOR.tenant_id)
        assert tenant is not None
        assert tenant.custom_config == '{"branding":"preserved"}'


def test_write_rechecks_fresh_membership_and_scopes_read(sql: SqlContext) -> None:
    repo, factory = sql
    repo.put_policy(ACTOR, POLICY, 0)
    with factory() as session, session.begin():
        member = session.query(TenantAccountJoin).one()
        member.role = TenantAccountRole.NORMAL
    with pytest.raises(CognitionPolicyDeniedError, match="policy_permission_denied"):
        repo.put_policy(ACTOR, POLICY, 1)
    assert repo.get_policy(Actor(tenant_id="33333333-3333-3333-3333-333333333333", account_id=ACTOR.account_id)) is None
    with pytest.raises(CognitionPolicyDeniedError, match="policy_permission_denied"):
        repo.require_member(
            Actor(tenant_id=ACTOR.tenant_id, account_id="44444444-4444-4444-4444-444444444444"), admin=False
        )


@pytest.mark.parametrize("change", [None, "restrict", "disable", "membership", "private"])
def test_absent_sql_policy_keeps_visible_native_selection_and_rechecks_after_metadata(
    sql: SqlContext, monkeypatch: pytest.MonkeyPatch, change: str | None
) -> None:
    from core.entities.provider_configuration import ProviderConfiguration
    from core.entities.provider_entities import CustomProviderConfiguration
    from core.model_manager import ModelManager
    from graphon.model_runtime.entities.common_entities import I18nObject
    from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
    from services.dify_builder.application.cognition_policy import CognitionPolicyService
    from services.dify_builder.cognition_model_gateway import NativeCognitionModels
    from tests.helpers.unit.core.model_fixtures import make_model_instance

    repo, factory = sql
    legacy = CognitionModel("session", "openai", "legacy-model", "chat", {"temperature": 0.7, "max_tokens": 8192})
    instance = make_model_instance(provider=legacy.provider, model=legacy.name)
    instance.provider_model_bundle.configuration.custom_configuration.provider = CustomProviderConfiguration(
        credentials={"token": "fixture-only"}, current_credential_id="visible-native-credential"
    )
    schema = AIModelEntity(
        model=legacy.name,
        label=I18nObject(en_US="Legacy native model"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
    )
    monkeypatch.setattr(ProviderConfiguration, "get_provider_model", lambda *_args, **_kwargs: schema)
    manager = ModelManager.for_tenant(ACTOR.tenant_id)
    monkeypatch.setattr(manager, "get_model_instance", lambda **_kwargs: instance)
    monkeypatch.setattr(manager, "get_default_model_instance", lambda **_kwargs: instance)
    monkeypatch.setattr(ModelManager, "for_tenant", lambda *_args, **_kwargs: manager)
    metadata_reads: list[int] = []

    class Visible:
        def model_credentials_visible(self, **selection: object) -> bool:
            assert selection["workspace_id"] == ACTOR.tenant_id
            assert selection["actor_id"] == ACTOR.account_id
            assert selection["provider_credential_ids"] == ["visible-native-credential"]
            metadata_reads.append(1)
            if change == "private":
                return False
            if change in {"restrict", "disable"}:
                repo.put_policy(ACTOR, CognitionPolicy(change != "disable", POLICY.models, "one", (), 0, "explicit"), 0)
            elif change == "membership":
                with factory.begin() as session:
                    session.delete(session.query(TenantAccountJoin).one())
            return True

    service = CognitionPolicyService(repo, NativeCognitionModels(Visible()))
    assert repo.get_policy(ACTOR) is None
    if change is None:
        selected = service.select(ACTOR, legacy.config())
        assert selected.config() == legacy.config()
        service.authorize_selected(ACTOR, selected)
        assert repo.get_policy(ACTOR) is None
    else:
        reason = {
            "restrict": "model_not_allowed",
            "disable": "builder_disabled",
            "membership": "policy_permission_denied",
            "private": "model_unavailable",
        }[change]
        with pytest.raises(CognitionPolicyDeniedError, match=reason):
            service.select(ACTOR, legacy.config())
    assert metadata_reads == [1]
