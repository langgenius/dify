from typing import Never, override

import pytest
import pytest_mock

from core.dify_builder.errors import BadRequestError, ModelUnavailableError, NotFoundError
from core.dify_builder.models import Actor, ConversationItem, DifyBuilderContext, Run, Session
from services.dify_builder import service as service_mod
from services.dify_builder.service import DifyBuilderService
from tests.unit_tests.core.dify_builder.fakes import InMemoryRepository
from tests.unit_tests.installed_spies import installed_mock

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
    def __init__(self, *, deny_access: bool = False) -> None:
        self.deny_access = deny_access

    def authorize(self, _actor: object, _app_id: object, _access: object) -> None:
        if self.deny_access:
            raise NotFoundError()

    def enqueue(self, *_args: object, **_kwargs: object) -> Never:
        raise AssertionError("unavailable model must not dispatch")

    def subscribe(self, _session_id: object) -> Never:
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


def test_build_session_freezes_default_model_config(
    mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch, actor: Actor
) -> None:
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
def test_authorization_precedes_model_resolution(
    mocker: pytest_mock.MockerFixture, actor: Actor, scenario: str
) -> None:
    validate = mocker.patch.object(service_mod, "validate_model_config", return_value=MC)
    repo = InMemoryRepository()
    mocker.spy(repo, "create_session")
    boundary = SchedulingBoundary(deny_access=True)
    svc = DifyBuilderService(repo, _FakeLock(), boundary.enqueue, authorize_app_fn=boundary.authorize)

    def create_session() -> None:
        if scenario == "build":
            svc.create_build_session(app_id="app-1", actor=actor, goal_text="Build it")
        elif scenario == "edit":
            svc.create_edit_session(app_id="app-1", actor=actor, goal_text="Build it")
        else:
            svc.create_fix_session(app_id="app-1", actor=actor, failed_run_id="run-1")

    with pytest.raises(NotFoundError):
        create_session()
    validate.assert_not_called()
    _installed_spy_1 = installed_mock(repo.create_session)
    _installed_spy_1.assert_not_called()


@pytest.mark.parametrize("scenario", ["build", "edit", "fix", "checklist"])
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("config", [None, MC])
def test_unavailable_model_rejected_before_session_subscription_or_dispatch(
    mocker: pytest_mock.MockerFixture, actor: Actor, scenario: str, streaming: bool, config: dict[str, object] | None
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

    def create_session() -> None:
        if scenario == "build":
            create_build = svc.create_build_session_stream if streaming else svc.create_build_session
            create_build(app_id="app-1", actor=actor, model_config=config, goal_text="Build it")
        elif scenario == "edit":
            create_edit = svc.create_edit_session_stream if streaming else svc.create_edit_session
            create_edit(app_id="app-1", actor=actor, model_config=config, goal_text="Build it")
        else:
            create_fix = svc.create_fix_session_stream if streaming else svc.create_fix_session
            if scenario == "checklist":
                from core.dify_builder.models import ChecklistError

                create_fix(
                    app_id="app-1",
                    actor=actor,
                    model_config=config,
                    checklist_errors=[ChecklistError(node_id="n1", node_type="llm", title="LLM")],
                )
            else:
                create_fix(app_id="app-1", actor=actor, model_config=config, failed_run_id="run-1")

    with pytest.raises(ModelUnavailableError):
        create_session()
    authorize.assert_called_once()
    validate.assert_called_once_with(actor.tenant_id, config)
    _installed_spy_2 = installed_mock(repo.create_session)
    _installed_spy_2.assert_not_called()
    _installed_spy_3 = installed_mock(repo.save_run)
    _installed_spy_3.assert_not_called()
    _installed_spy_4 = installed_mock(lock.acquire)
    _installed_spy_4.assert_not_called()
    subscribe.assert_not_called()
    enqueue.assert_not_called()
