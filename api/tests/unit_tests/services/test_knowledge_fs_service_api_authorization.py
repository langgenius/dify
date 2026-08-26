from __future__ import annotations

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.enums import ApiTokenType
from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
)
from models.model import ApiToken
from services.knowledge_fs.service_api_authorization import (
    KnowledgeFSServiceApiAuthorizationError,
    KnowledgeFSServiceApiAuthorizationService,
)

_MODELS = (
    ApiToken,
    KnowledgeFSControlSpace,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSAuthorizationRevision,
)


def _seed(sqlite_session: Session, *, enabled: bool = True) -> tuple[ApiToken, KnowledgeFSControlSpace]:
    token = ApiToken(tenant_id="tenant-1", type=ApiTokenType.DATASET, token="dataset-key")
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        knowledge_space_id="knowledge-space-1",
        knowledge_space_revision=7,
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all(
        [
            token,
            space,
            KnowledgeFSExternalAccessPolicy(
                tenant_id="tenant-1",
                control_space_id=space.id,
                service_api_enabled=enabled,
            ),
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=space.id,
                membership_epoch=1,
                space_acl_epoch=2,
                external_access_epoch=3,
                content_policy_revision=4,
            ),
        ]
    )
    sqlite_session.commit()
    return token, space


@pytest.mark.parametrize("sqlite_session", [_MODELS], indirect=True)
def test_dataset_key_authorizes_an_enabled_space(sqlite_session: Session) -> None:
    token, space = _seed(sqlite_session)
    service = KnowledgeFSServiceApiAuthorizationService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    )

    profile = service.authorize(
        api_token_id=token.id,
        tenant_id="tenant-1",
        control_space_id=space.id,
    )

    assert profile.api_token_id == token.id
    assert profile.principal_id == token.id
    assert profile.knowledge_space_id == "knowledge-space-1"
    assert profile.knowledge_space_revision == 7
    assert profile.external_access_epoch == 3


@pytest.mark.parametrize("sqlite_session", [_MODELS], indirect=True)
@pytest.mark.parametrize("failure", ["disabled", "cross_tenant", "wrong_token_type"])
def test_dataset_key_authorization_fails_closed(sqlite_session: Session, failure: str) -> None:
    token, space = _seed(sqlite_session, enabled=failure != "disabled")
    if failure == "wrong_token_type":
        token.type = ApiTokenType.APP
        sqlite_session.commit()
    service = KnowledgeFSServiceApiAuthorizationService(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    )

    with pytest.raises(KnowledgeFSServiceApiAuthorizationError):
        service.authorize(
            api_token_id=token.id,
            tenant_id="tenant-2" if failure == "cross_tenant" else "tenant-1",
            control_space_id=space.id,
        )
