"""Dataset API key revocation stays safe across cache and transaction boundaries."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from functools import partial
from uuid import UUID, uuid4

import pytest
from flask import Flask
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from controllers.service_api import flask_admission
from controllers.service_api.flask_admission import DatasetApiResource
from machinery.context import RequestContext
from models.dataset import Dataset
from models.enums import ApiTokenType
from models.model import ApiToken, DatasetApiTokenBinding
from repositories.knowledge.dataset_api_key_repository import DatasetApiKeyRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.api_token_service import ApiTokenCache
from services.knowledge.admission.application import DatasetAdmissionService
from services.knowledge.resource_scope import DatasetRef

WORKSPACE_ID = str(uuid4())
OTHER_WORKSPACE_ID = str(uuid4())
OWNER_ID = str(uuid4())


def _dataset(dataset_id: str, *, workspace_id: str = WORKSPACE_ID) -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=workspace_id,
        name=f"Dataset {dataset_id}",
        description="",
        provider="vendor",
        permission="only_me",
        created_by=OWNER_ID,
        maintainer=OWNER_ID,
        indexing_technique="economy",
        chunk_structure="text_model",
        enable_api=True,
    )


def _api_token(
    token_id: str,
    raw_token: str,
    *,
    workspace_id: str = WORKSPACE_ID,
    token_type: ApiTokenType = ApiTokenType.DATASET,
) -> ApiToken:
    return ApiToken(id=token_id, tenant_id=workspace_id, type=token_type, token=raw_token)


def _dataset_repository(
    sessions: sessionmaker[Session],
    *,
    revoke: Callable[[Session, Sequence[str]], None] | None = None,
) -> SQLAlchemyDatasetRepository:
    return SQLAlchemyDatasetRepository(
        session_factory=sessions,
        wake_after_commit=lambda _session: None,
        revoke_keys_after_commit=revoke or (lambda _session, _tokens: None),
    )


class _NoLimits:
    def check(
        self,
        workspace_id: str,
        *,
        rate_limit: bool,
        billing_resources: tuple[str, ...],
        require_paid_segments: bool,
    ) -> None:
        del workspace_id, rate_limit, billing_resources, require_paid_segments


@dataclass(frozen=True, slots=True)
class _WorkspaceOwner:
    owner_id: str

    def active_owner_id(self, workspace_id: str) -> str | None:
        return self.owner_id if workspace_id == WORKSPACE_ID else None


@dataclass(frozen=True, slots=True)
class _CachedIdentity:
    id: str
    tenant_id: str


@dataclass(frozen=True, slots=True)
class _Account:
    id: str
    has_edit_permission: bool = True


@dataclass(frozen=True, slots=True)
class _Identity:
    account: _Account

    def get_account_for_workspace(self, account_id: str, workspace_id: str) -> _Account | None:
        if account_id == self.account.id and workspace_id == WORKSPACE_ID:
            return self.account
        return None


class _UnexpectedResourceTokens:
    def resolve_datasets_for_service_api(self, *, token: str, dataset_id: str | None) -> None:
        del token, dataset_id
        raise AssertionError("dataset API keys must not use resource-token resolution")


@dataclass(frozen=True, slots=True)
class _KnowledgeServices:
    admission: DatasetAdmissionService


@dataclass(frozen=True, slots=True)
class _AccountServices:
    identity: _Identity


@dataclass(frozen=True, slots=True)
class _ApplicationServices:
    knowledge: _KnowledgeServices
    accounts: _AccountServices
    resource_access_tokens: _UnexpectedResourceTokens


@dataclass(slots=True)
class _LoginManager:
    users: list[_Account] = field(default_factory=list)

    def _update_request_context_with_user(self, user: _Account) -> None:
        self.users.append(user)


class _Signal:
    def send(self, sender: object, *, user: _Account) -> None:
        del sender, user


def _http_client(
    monkeypatch: pytest.MonkeyPatch,
    sessions: sessionmaker[Session],
    *,
    cached_identity: _CachedIdentity,
) -> Flask:
    account = _Account(OWNER_ID)
    admission = DatasetAdmissionService(
        datasets=_dataset_repository(sessions),
        keys=DatasetApiKeyRepository(session_factory=sessions),
        workspaces=_WorkspaceOwner(OWNER_ID),
        limits=_NoLimits(),
    )
    services = _ApplicationServices(
        knowledge=_KnowledgeServices(admission),
        accounts=_AccountServices(_Identity(account)),
        resource_access_tokens=_UnexpectedResourceTokens(),
    )
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.login_manager = _LoginManager()  # type: ignore[attr-defined]

    monkeypatch.setattr(flask_admission, "application_services", lambda: services)
    monkeypatch.setattr(flask_admission, "validate_and_get_api_token", lambda _scope=None: cached_identity)
    monkeypatch.setattr(flask_admission, "get_request_id", lambda: "request-id")
    monkeypatch.setattr(flask_admission, "get_trace_id", lambda: "")
    monkeypatch.setattr(flask_admission, "current_user", account)
    monkeypatch.setattr(flask_admission, "user_logged_in", _Signal())

    def dataset_endpoint(request_context: RequestContext, *, dataset_id: UUID) -> dict[str, str]:
        return {
            "workspace_id": request_context.active_workspace_id,
            "dataset_id": str(dataset_id),
        }

    def collection_endpoint(request_context: RequestContext) -> dict[str, str]:
        return {"workspace_id": request_context.active_workspace_id}

    admitted_dataset = DatasetApiResource.method_decorators[0](dataset_endpoint)
    admitted_collection = DatasetApiResource.method_decorators[0](collection_endpoint)
    app.add_url_rule(
        "/datasets/<uuid:dataset_id>",
        endpoint="dataset",
        view_func=lambda dataset_id: admitted_dataset(dataset_id=dataset_id),
    )
    app.add_url_rule("/datasets", endpoint="datasets", view_func=admitted_collection)
    return app


def _authorization(raw_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {raw_token}"}


def test_active_scope_distinguishes_unbound_missing_foreign_and_wrong_type(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    dataset_id = str(uuid4())
    scoped_id = str(uuid4())
    unbound_id = str(uuid4())
    foreign_id = str(uuid4())
    wrong_type_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(_dataset(dataset_id))
        session.add_all(
            [
                _api_token(scoped_id, "dataset-scoped"),
                _api_token(unbound_id, "dataset-unbound"),
                _api_token(foreign_id, "dataset-foreign", workspace_id=OTHER_WORKSPACE_ID),
                _api_token(wrong_type_id, "app-key", token_type=ApiTokenType.APP),
                DatasetApiTokenBinding(api_token_id=scoped_id, dataset_id=dataset_id),
            ]
        )

    repository = DatasetApiKeyRepository(session_factory=sqlite_session_factory)

    assert repository.get_active_scope(WORKSPACE_ID, scoped_id) == frozenset({dataset_id})
    assert repository.get_active_scope(WORKSPACE_ID, unbound_id) == frozenset()
    assert repository.get_active_scope(WORKSPACE_ID, str(uuid4())) is None
    assert repository.get_active_scope(WORKSPACE_ID, foreign_id) is None
    assert repository.get_active_scope(WORKSPACE_ID, wrong_type_id) is None


def test_active_unbound_key_is_valid_for_scoped_and_collection_http_requests(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset_id = str(uuid4())
    key_id = str(uuid4())
    raw_token = "dataset-active-unbound"
    with sqlite_session_factory.begin() as session:
        session.add_all([_dataset(dataset_id), _api_token(key_id, raw_token)])

    app = _http_client(
        monkeypatch,
        sqlite_session_factory,
        cached_identity=_CachedIdentity(key_id, WORKSPACE_ID),
    )
    client = app.test_client()

    scoped = client.get(f"/datasets/{dataset_id}", headers=_authorization(raw_token))
    collection = client.get("/datasets", headers=_authorization(raw_token))

    assert scoped.status_code == 200
    assert scoped.get_json() == {"workspace_id": WORKSPACE_ID, "dataset_id": dataset_id}
    assert collection.status_code == 200
    assert collection.get_json() == {"workspace_id": WORKSPACE_ID}


@pytest.mark.parametrize(
    ("stored_workspace_id", "stored_type"),
    [
        (OTHER_WORKSPACE_ID, ApiTokenType.DATASET),
        (WORKSPACE_ID, ApiTokenType.APP),
    ],
    ids=["foreign-workspace", "wrong-token-type"],
)
def test_stale_cached_identity_for_foreign_or_wrong_type_key_gets_http_401(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    stored_workspace_id: str,
    stored_type: ApiTokenType,
) -> None:
    dataset_id = str(uuid4())
    key_id = str(uuid4())
    raw_token = "dataset-stale-identity"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset(dataset_id),
                _api_token(key_id, raw_token, workspace_id=stored_workspace_id, token_type=stored_type),
            ]
        )

    app = _http_client(
        monkeypatch,
        sqlite_session_factory,
        cached_identity=_CachedIdentity(key_id, WORKSPACE_ID),
    )

    response = app.test_client().get(f"/datasets/{dataset_id}", headers=_authorization(raw_token))

    assert response.status_code == 401


def test_deleted_dataset_key_is_rejected_even_when_cached_identity_survives(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    deleted_dataset_id = str(uuid4())
    surviving_dataset_id = str(uuid4())
    key_id = str(uuid4())
    raw_token = "dataset-revoked-but-cached"
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset(deleted_dataset_id),
                _dataset(surviving_dataset_id),
                _api_token(key_id, raw_token),
                DatasetApiTokenBinding(api_token_id=key_id, dataset_id=deleted_dataset_id),
            ]
        )

    assert _dataset_repository(sqlite_session_factory).delete_with_relations(
        DatasetRef(WORKSPACE_ID, deleted_dataset_id)
    )
    assert (
        DatasetApiKeyRepository(session_factory=sqlite_session_factory).get_active_scope(WORKSPACE_ID, key_id) is None
    )

    app = _http_client(
        monkeypatch,
        sqlite_session_factory,
        cached_identity=_CachedIdentity(key_id, WORKSPACE_ID),
    )
    client = app.test_client()

    scoped = client.get(f"/datasets/{surviving_dataset_id}", headers=_authorization(raw_token))
    collection = client.get("/datasets", headers=_authorization(raw_token))

    assert scoped.status_code == 401
    assert collection.status_code == 401


def test_cache_delete_runs_only_after_commit_and_never_after_rollback(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    evictions: list[tuple[str, str]] = []

    def record(token: str, scope: str) -> bool:
        evictions.append((token, scope))
        return True

    monkeypatch.setattr(ApiTokenCache, "delete", record)

    with sqlite_session_factory() as session:
        session.begin()
        ApiTokenCache.delete_after_commit(session, ["rolled-back"], scope="dataset")
        assert evictions == []
        session.rollback()
    assert evictions == []

    with sqlite_session_factory.begin() as session:
        ApiTokenCache.delete_after_commit(session, ["committed"], scope="dataset")
        assert evictions == []
    assert evictions == [("committed", "dataset")]


def test_dataset_delete_evicts_only_sole_bound_key_after_commit(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    deleted_dataset_id = str(uuid4())
    other_dataset_id = str(uuid4())
    sole_id = str(uuid4())
    multi_id = str(uuid4())
    unbound_id = str(uuid4())
    evictions: list[tuple[str, str, bool]] = []

    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset(deleted_dataset_id),
                _dataset(other_dataset_id),
                _api_token(sole_id, "dataset-sole"),
                _api_token(multi_id, "dataset-multi"),
                _api_token(unbound_id, "dataset-unbound"),
                DatasetApiTokenBinding(api_token_id=sole_id, dataset_id=deleted_dataset_id),
                DatasetApiTokenBinding(api_token_id=multi_id, dataset_id=deleted_dataset_id),
                DatasetApiTokenBinding(api_token_id=multi_id, dataset_id=other_dataset_id),
            ]
        )

    def record(token: str, scope: str) -> bool:
        with sqlite_session_factory() as session:
            dataset_still_exists = session.get(Dataset, deleted_dataset_id) is not None
        evictions.append((token, scope, dataset_still_exists))
        return True

    monkeypatch.setattr(ApiTokenCache, "delete", record)
    repository = _dataset_repository(
        sqlite_session_factory,
        revoke=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
    )

    assert repository.delete_with_relations(DatasetRef(WORKSPACE_ID, deleted_dataset_id))

    assert evictions == [("dataset-sole", "dataset", False)]
    keys = DatasetApiKeyRepository(session_factory=sqlite_session_factory)
    assert keys.get_active_scope(WORKSPACE_ID, sole_id) is None
    multi_scope = keys.get_active_scope(WORKSPACE_ID, multi_id)
    assert multi_scope is not None
    assert other_dataset_id in multi_scope
    assert keys.get_active_scope(WORKSPACE_ID, unbound_id) == frozenset()


def test_dataset_delete_commit_failure_preserves_key_and_never_evicts_cache(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    dataset_id = str(uuid4())
    key_id = str(uuid4())
    raw_token = "dataset-rollback"
    evictions: list[tuple[str, str]] = []
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset(dataset_id),
                _api_token(key_id, raw_token),
                DatasetApiTokenBinding(api_token_id=key_id, dataset_id=dataset_id),
            ]
        )

    class FailingCommitSession(Session):
        pass

    factory: sessionmaker[Session] = sessionmaker(
        bind=sqlite_session_factory.kw["bind"],
        class_=FailingCommitSession,
        expire_on_commit=False,
    )

    @event.listens_for(factory, "before_commit", once=True)
    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    def record(token: str, scope: str) -> bool:
        evictions.append((token, scope))
        return True

    monkeypatch.setattr(ApiTokenCache, "delete", record)
    repository = _dataset_repository(
        factory,
        revoke=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
    )

    with pytest.raises(RuntimeError, match="commit failed"):
        repository.delete_with_relations(DatasetRef(WORKSPACE_ID, dataset_id))

    assert evictions == []
    with sqlite_session_factory() as session:
        assert session.get(Dataset, dataset_id) is not None
        assert session.get(ApiToken, key_id) is not None
        assert (
            session.scalar(
                select(DatasetApiTokenBinding).where(
                    DatasetApiTokenBinding.api_token_id == key_id,
                    DatasetApiTokenBinding.dataset_id == dataset_id,
                )
            )
            is not None
        )
