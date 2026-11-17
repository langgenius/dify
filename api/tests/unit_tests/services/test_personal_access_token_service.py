"""PAT admission policy tests use the Store contract without ORM/session fixtures."""

from collections.abc import Callable
from datetime import datetime
from typing import Literal, cast

from constants.personal_access_token import PersonalAccessTokenPolicy
from libs.datetime_utils import naive_utc_now
from services.app.console_service import ConsoleAppService
from services.knowledge.datasets.application import DatasetApplicationService
from services.personal_access_token_service import (
    PersonalAccessTokenDeploymentCatalog,
    PersonalAccessTokenDetails,
    PersonalAccessTokenRecord,
    PersonalAccessTokenResourceRef,
    PersonalAccessTokenResourceView,
    PersonalAccessTokenScopes,
    PersonalAccessTokenService,
    PersonalAccessTokenSummary,
    PersonalAccessTokenWorkspaceView,
)

ACCOUNT_ID = "account-1"
TOKEN_ID = "token-1"
WORKSPACE_A = "workspace-a"
WORKSPACE_B = "workspace-b"
WORKSPACE_C = "workspace-c"
ScopeMode = Literal["all", "selected", "none"]


class _FakeTokenStore:
    """Only ``get`` is exercised by ``authorize``; the rest of the protocol is unused."""

    def __init__(self, record: PersonalAccessTokenRecord) -> None:
        self._record = record

    def get(self, account_id: str, token_id: str) -> PersonalAccessTokenRecord:
        assert (account_id, token_id) == (ACCOUNT_ID, TOKEN_ID)
        return self._record

    def create(self, record: PersonalAccessTokenRecord) -> PersonalAccessTokenSummary:
        raise NotImplementedError

    def find_creation(self, account_id: str, key: str, fingerprint: str) -> PersonalAccessTokenSummary | None:
        raise NotImplementedError

    def list_details(self, account_id: str, *, page: int, limit: int) -> tuple[PersonalAccessTokenDetails, ...]:
        raise NotImplementedError

    def count_tokens(self, account_id: str) -> int:
        raise NotImplementedError

    def authenticate(
        self, token_id: str, *, now: datetime, verify: Callable[[str, str], bool]
    ) -> PersonalAccessTokenRecord | None:
        raise NotImplementedError

    def revoke(self, account_id: str, token_id: str) -> None:
        raise NotImplementedError

    def details(self, account_id: str, token_id: str) -> PersonalAccessTokenDetails:
        raise NotImplementedError

    def update(
        self,
        account_id: str,
        token_id: str,
        *,
        name: str,
        version: int,
        scopes: PersonalAccessTokenScopes | None,
        now: datetime,
        validated_resources: tuple[PersonalAccessTokenResourceView, ...],
    ) -> PersonalAccessTokenDetails:
        raise NotImplementedError

    def current_workspace(self, account_id: str) -> PersonalAccessTokenWorkspaceView | None:
        raise NotImplementedError

    def workspace_candidates(
        self,
        account_id: str,
        *,
        keyword: str | None,
        offset: int = 0,
        limit: int | None = None,
    ) -> tuple[PersonalAccessTokenWorkspaceView, ...]:
        raise NotImplementedError


def _record(
    *,
    resource_mode: ScopeMode,
    resources: tuple[PersonalAccessTokenResourceRef, ...] = (),
    resource_workspace_ids: frozenset[str] = frozenset(),
    workspace_mode: ScopeMode,
    workspace_ids: tuple[str, ...] = (),
) -> PersonalAccessTokenRecord:
    return PersonalAccessTokenRecord(
        summary=PersonalAccessTokenSummary(
            id=TOKEN_ID,
            name="token",
            secret_last_four="1234",
            created_at=naive_utc_now(),
            expires_at=None,
            resource_scope_mode=resource_mode,
            workspace_scope_mode=workspace_mode,
        ),
        account_id=ACCOUNT_ID,
        secret_digest="digest",
        scopes=PersonalAccessTokenScopes(
            resource_mode=resource_mode,
            resources=resources,
            workspace_mode=workspace_mode,
            workspace_ids=workspace_ids,
        ),
        resource_workspace_ids=resource_workspace_ids,
    )


def _service(record: PersonalAccessTokenRecord) -> PersonalAccessTokenService:
    return PersonalAccessTokenService(
        tokens=_FakeTokenStore(record),
        apps=cast(ConsoleAppService, object()),
        datasets=cast(DatasetApplicationService, object()),
        deployments=cast(PersonalAccessTokenDeploymentCatalog, object()),
    )


def _authorize(service: PersonalAccessTokenService, policy: PersonalAccessTokenPolicy) -> frozenset[str] | None:
    return service.authorize(
        account_id=ACCOUNT_ID,
        token_id=TOKEN_ID,
        policy=policy,
        workspace_id=None,
        app_id=None,
    ).workspace_ids


def test_workspace_discovery_resource_all_is_unrestricted() -> None:
    for workspace_mode, workspace_ids in (("all", ()), ("selected", (WORKSPACE_A,)), ("none", ())):
        service = _service(_record(resource_mode="all", workspace_mode=workspace_mode, workspace_ids=workspace_ids))
        assert _authorize(service, PersonalAccessTokenPolicy.WORKSPACE_DISCOVERY) is None


def test_workspace_discovery_selected_resources_expose_owner_workspaces() -> None:
    service = _service(
        _record(
            resource_mode="selected",
            resources=(
                PersonalAccessTokenResourceRef("app", "app-1"),
                PersonalAccessTokenResourceRef("dataset", "dataset-1"),
            ),
            resource_workspace_ids=frozenset({WORKSPACE_B, WORKSPACE_C}),
            workspace_mode="none",
        )
    )
    assert _authorize(service, PersonalAccessTokenPolicy.WORKSPACE_DISCOVERY) == frozenset({WORKSPACE_B, WORKSPACE_C})


def test_workspace_discovery_unions_workspace_scope_and_resource_owners() -> None:
    service = _service(
        _record(
            resource_mode="selected",
            resources=(PersonalAccessTokenResourceRef("app", "app-1"),),
            resource_workspace_ids=frozenset({WORKSPACE_B}),
            workspace_mode="selected",
            workspace_ids=(WORKSPACE_A,),
        )
    )
    assert _authorize(service, PersonalAccessTokenPolicy.WORKSPACE_DISCOVERY) == frozenset({WORKSPACE_A, WORKSPACE_B})


def test_workspace_discovery_without_any_scope_is_empty() -> None:
    service = _service(_record(resource_mode="none", workspace_mode="none"))
    assert _authorize(service, PersonalAccessTokenPolicy.WORKSPACE_DISCOVERY) == frozenset()


def test_workspace_discovery_workspace_all_wins_over_resource_scope() -> None:
    service = _service(
        _record(
            resource_mode="selected",
            resources=(PersonalAccessTokenResourceRef("app", "app-1"),),
            resource_workspace_ids=frozenset({WORKSPACE_B}),
            workspace_mode="all",
        )
    )
    assert _authorize(service, PersonalAccessTokenPolicy.WORKSPACE_DISCOVERY) is None


def test_identity_discovery_keeps_workspace_scope_only() -> None:
    service = _service(
        _record(
            resource_mode="selected",
            resources=(PersonalAccessTokenResourceRef("app", "app-1"),),
            resource_workspace_ids=frozenset({WORKSPACE_B}),
            workspace_mode="none",
        )
    )
    assert _authorize(service, PersonalAccessTokenPolicy.IDENTITY_DISCOVERY) == frozenset()
