from typing import Never, override

import pytest

from core.dify_builder.errors import BadRequestError, ModelUnavailableError, NotFoundError
from core.dify_builder.models import Actor, ConversationItem, DifyBuilderContext, Run, Session
from services.dify_builder import service as service_mod
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository

MC: dict[str, object] = {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}


class _FakeRepo(InMemoryRepository):
    def __init__(self) -> None:
        super().__init__()
        self.created_fc: DifyBuilderContext | None = None

    @override
    def create_session(self, session: Session, initial_fc: DifyBuilderContext, items: list[ConversationItem]) -> None:
        self.created_fc = initial_fc
        session.id = "sess-1"
        session.version = 1

    @override
    def save_run(self, session_id: str, run: Run) -> None:
        pass

    @override
    def get_session(self, id: str) -> Never:
        raise AssertionError("view not needed for this test")


class _FakeLock:
    def acquire(self, session_id: str) -> str:  # noqa: ARG002
        return "tok"

    def release(self, session_id: str, token: str) -> None:
        pass

    def exists(self, session_id: str) -> bool:  # noqa: ARG002
        return True


class SchedulingBoundary:
    def __init__(self, *, deny_access: bool = False):
        self.deny_access = deny_access

    def authorize(self, _actor, _app_id, _access):
        if self.deny_access:
            raise NotFoundError()

    def enqueue(self, *_args, **_kwargs):
        raise AssertionError("unavailable model must not dispatch")

    def subscribe(self, _session_id):
        raise AssertionError("unavailable model must not subscribe")


@pytest.fixture
def actor() -> Actor:
    return Actor(account_id="acc-1", tenant_id="t1")


def _service(repo: InMemoryRepository) -> DifyBuilderService:
    # enqueue is a no-op; dispatch still acquires/releases the fake lock.
    return DifyBuilderService(repo, _FakeLock(), lambda *a, **k: None)  # noqa: ARG005


def test_build_session_stamps_model_config(monkeypatch: pytest.MonkeyPatch, actor: Actor) -> None:
    monkeypatch.setattr(service_mod, "validate_model_config", lambda tenant_id, mc: mc)  # noqa: ARG005
    # get_session_view is called after dispatch; stub it to return the created fc's owner view path.
    repo = _FakeRepo()
    svc = _service(repo)
    monkeypatch.setattr(svc, "get_session_view", lambda sid, a: "VIEW")  # noqa: ARG005
    svc.create_build_session(app_id="app-1", actor=actor, goal_text="g", model_config=MC)
    assert repo.created_fc is not None
    assert repo.created_fc.model_config == MC


def test_build_session_freezes_default_model_config(mocker, monkeypatch: pytest.MonkeyPatch, actor: Actor) -> None:
    validate = mocker.patch.object(service_mod, "validate_model_config", return_value=MC)
    repo = _FakeRepo()
    svc = _service(repo)
    monkeypatch.setattr(svc, "get_session_view", lambda sid, a: "VIEW")  # noqa: ARG005
    svc.create_build_session(app_id="app-1", actor=actor, goal_text="g")
    assert repo.created_fc is not None
    assert repo.created_fc.model_config == MC
    validate.assert_called_once_with(actor.tenant_id, None)


def test_invalid_model_config_raises_before_persist(monkeypatch: pytest.MonkeyPatch, actor: Actor) -> None:
    def boom(tenant_id: str, mc: dict[str, object] | None) -> Never:  # noqa: ARG001
        raise BadRequestError("bad model")

    monkeypatch.setattr(service_mod, "validate_model_config", boom)
    repo = _FakeRepo()
    svc = _service(repo)
    with pytest.raises(BadRequestError):
        svc.create_edit_session(app_id="app-1", actor=actor, goal_text="edit it", model_config=MC)
    assert repo.created_fc is None  # never persisted


@pytest.mark.parametrize("scenario", ["build", "edit", "fix"])
def test_authorization_precedes_model_resolution(mocker, actor: Actor, scenario: str) -> None:
    validate = mocker.patch.object(service_mod, "validate_model_config", return_value=MC)
    repo = InMemoryRepository()
    mocker.spy(repo, "create_session")
    boundary = SchedulingBoundary(deny_access=True)
    svc = DifyBuilderService(repo, _FakeLock(), boundary.enqueue, authorize_app_fn=boundary.authorize)
    kwargs = {"failed_run_id": "run-1"} if scenario == "fix" else {"goal_text": "Build it"}
    with pytest.raises(NotFoundError):
        {"build": svc.create_build_session, "edit": svc.create_edit_session, "fix": svc.create_fix_session}[scenario](
            app_id="app-1", actor=actor, **kwargs
        )
    validate.assert_not_called()
    repo.create_session.assert_not_called()


@pytest.mark.parametrize("scenario", ["build", "edit", "fix", "checklist"])
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("config", [None, MC])
def test_unavailable_model_rejected_before_session_subscription_or_dispatch(
    mocker, actor: Actor, scenario: str, streaming: bool, config: dict[str, object] | None
) -> None:
    validate = mocker.patch.object(
        service_mod, "validate_model_config", side_effect=ModelUnavailableError("unavailable")
    )
    repo = InMemoryRepository()
    mocker.spy(repo, "create_session")
    mocker.spy(repo, "save_run")
    lock = _FakeLock()
    mocker.spy(lock, "acquire")
    boundary = SchedulingBoundary()
    enqueue = mocker.spy(boundary, "enqueue")
    subscribe = mocker.spy(boundary, "subscribe")
    authorize = mocker.spy(boundary, "authorize")
    svc = DifyBuilderService(repo, lock, enqueue, subscribe_fn=subscribe, authorize_app_fn=authorize)
    mode = "fix" if scenario == "checklist" else scenario
    create = {
        ("build", False): svc.create_build_session,
        ("edit", False): svc.create_edit_session,
        ("fix", False): svc.create_fix_session,
        ("build", True): svc.create_build_session_stream,
        ("edit", True): svc.create_edit_session_stream,
        ("fix", True): svc.create_fix_session_stream,
    }[(mode, streaming)]
    kwargs = {"goal_text": "Build it"} if mode != "fix" else {"failed_run_id": "run-1"}
    if scenario == "checklist":
        from core.dify_builder.models import ChecklistError

        kwargs = {"checklist_errors": [ChecklistError(node_id="n1", node_type="llm", title="LLM")]}
    with pytest.raises(ModelUnavailableError):
        create(app_id="app-1", actor=actor, model_config=config, **kwargs)
    authorize.assert_called_once()
    validate.assert_called_once_with(actor.tenant_id, config)
    repo.create_session.assert_not_called()
    repo.save_run.assert_not_called()
    lock.acquire.assert_not_called()
    subscribe.assert_not_called()
    enqueue.assert_not_called()
