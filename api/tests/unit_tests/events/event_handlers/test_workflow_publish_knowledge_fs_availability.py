"""Publication cannot depend on undeployed optional KnowledgeFS schema."""

import json

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from pydantic import SecretStr
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session, sessionmaker

from events.event_handlers.sync_knowledge_fs_bindings_when_app_published_workflow_updated import handle
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
)
from models.model import App, AppMode
from models.workflow import Workflow
from tests.helpers.unit.config_override import config_overrides_context


@pytest.mark.parametrize("external", [False, True])
def test_disabled_knowledge_fs_does_not_open_a_transaction_or_require_its_tables(external: bool) -> None:
    """Native and external-only publications work against a database with zero KFS tables."""
    data = {"type": "agent", "version": "2", "agent_node_kind": "external_a2a"} if external else {"type": "end"}
    app = App(
        id="owned-app",
        tenant_id="owned-tenant",
        name="Owned test",
        mode=AppMode.WORKFLOW,
        enable_site=False,
        enable_api=False,
    )
    workflow = Workflow(created_by="owned-account", graph=json.dumps({"nodes": [{"id": "node", "data": data}]}))
    engine = create_engine("sqlite://")
    try:
        assert inspect(engine).get_table_names() == []
        with Session(engine) as session, config_overrides_context(KNOWLEDGE_FS_ENABLED=False):
            handle(app, published_workflow=workflow, session=session)
            assert not session.in_transaction()
        assert inspect(engine).get_table_names() == []
    finally:
        engine.dispose()


def test_enabled_knowledge_fs_still_revokes_removed_binding_in_publish_transaction(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Real composition/SQL maintain old bindings when an enabled workflow removes its last Space."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    app = App(
        id="owned-app",
        tenant_id="owned-tenant",
        name="Owned test",
        mode=AppMode.WORKFLOW,
        enable_site=False,
        enable_api=False,
    )
    space = KnowledgeFSControlSpace(
        tenant_id=app.tenant_id,
        owner_account_id="owned-account",
        provisioning_key="owned-provision",
        knowledge_space_id="owned-space",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    revision = KnowledgeFSAuthorizationRevision(tenant_id=app.tenant_id, control_space_id=space.id)
    binding = AppKnowledgeFSSpaceJoin(
        tenant_id=app.tenant_id,
        control_space_id=space.id,
        app_id=app.id,
        join_type=KnowledgeFSAppSpaceJoinType.WORKFLOW,
        created_by_account_id="owned-account",
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([app, space, revision, binding])
    workflow = Workflow(created_by="owned-account", graph=json.dumps({"nodes": [{"data": {"type": "end"}}]}))
    with (
        config_overrides_context(
            KNOWLEDGE_FS_ENABLED=True,
            KNOWLEDGE_FS_COMMUNITY_DEV_ENABLED=True,
            KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.example.test",
            KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=True,
            KNOWLEDGE_FS_CAPABILITY_V2_SIGNING_KID="owned-test-key",
            KNOWLEDGE_FS_CAPABILITY_V2_PRIVATE_KEY_PEM=SecretStr(pem),
        ),
        sqlite_session_factory() as session,
    ):
        handle(app, published_workflow=workflow, session=session)
        session.flush()
        revoked = session.get(AppKnowledgeFSSpaceJoin, binding.id)
        assert revoked is not None
        assert revoked.status == KnowledgeFSAppSpaceJoinStatus.REVOKED
        assert revoked.revoked_by_account_id == "owned-account"
        assert revoked.revision == binding.revision + 1
        marker = session.get(KnowledgeFSAuthorizationRevision, revision.id)
        assert marker is not None
        assert marker.external_access_epoch == revision.external_access_epoch + 1
        handle(app, published_workflow=workflow, session=session)
        session.flush()
        assert revoked.revision == binding.revision + 1
        assert marker.external_access_epoch == revision.external_access_epoch + 1
        session.rollback()
    with sqlite_session_factory() as session:
        unchanged = session.get(AppKnowledgeFSSpaceJoin, binding.id)
        assert unchanged is not None
        assert unchanged.status == KnowledgeFSAppSpaceJoinStatus.ACTIVE
