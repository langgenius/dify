from unittest.mock import Mock

import pytest

from core.dify_builder.errors import BadRequestError, ModelUnavailableError, NotFoundError
from core.dify_builder.models import Actor
from services.dify_builder import service as service_mod
from services.dify_builder.service import DifyBuilderService

MC = {"provider": "openai", "name": "gpt-4o", "mode": "chat", "completion_params": {}}


class _FakeRepo:
    def __init__(self):
        self.created_fc = None

    def create_session(self, s, fc, items):  # noqa: ARG002
        self.created_fc = fc
        s.id = "sess-1"
        s.version = 1

    def save_run(self, session_id, run):
        pass

    def get_session(self, session_id):  # noqa: ARG002
        raise AssertionError("view not needed for this test")


class _FakeLock:
    def acquire(self, session_id):  # noqa: ARG002
        return "tok"

    def release(self, session_id, token):
        pass

    def exists(self, session_id):  # noqa: ARG002
        return True


@pytest.fixture
def actor():
    return Actor(account_id="acc-1", tenant_id="t1")


def _service(repo):
    # enqueue is a no-op; dispatch still acquires/releases the fake lock.
    return DifyBuilderService(repo, _FakeLock(), lambda *a, **k: None)  # noqa: ARG005


def test_build_session_stamps_model_config(monkeypatch, actor):
    monkeypatch.setattr(service_mod, "validate_model_config", lambda tenant_id, mc: mc)  # noqa: ARG005
    monkeypatch.setattr(
        service_mod.FeatureService,
        "get_features",
        staticmethod(lambda tenant_id: type("F", (), {"skill_learning_policy": "ask"})()),  # noqa: ARG005
    )
    # get_session_view is called after dispatch; stub it to return the created fc's owner view path.
    repo = _FakeRepo()
    svc = _service(repo)
    monkeypatch.setattr(svc, "get_session_view", lambda sid, a: "VIEW")  # noqa: ARG005
    svc.create_build_session(app_id="app-1", actor=actor, goal_text="g", model_config=MC)
    assert repo.created_fc.model_config == MC


def test_build_session_freezes_default_model_config(monkeypatch, actor):
    validate = Mock(return_value=MC)
    monkeypatch.setattr(service_mod, "validate_model_config", validate)
    monkeypatch.setattr(
        service_mod.FeatureService,
        "get_features",
        staticmethod(lambda tenant_id: type("F", (), {"skill_learning_policy": "ask"})()),  # noqa: ARG005
    )
    repo = _FakeRepo()
    svc = _service(repo)
    monkeypatch.setattr(svc, "get_session_view", lambda sid, a: "VIEW")  # noqa: ARG005
    svc.create_build_session(app_id="app-1", actor=actor, goal_text="g")
    assert repo.created_fc.model_config == MC
    validate.assert_called_once_with(actor.tenant_id, None)


def test_invalid_model_config_raises_before_persist(monkeypatch, actor):
    def boom(tenant_id, mc):  # noqa: ARG001
        raise BadRequestError("bad model")

    monkeypatch.setattr(service_mod, "validate_model_config", boom)
    repo = _FakeRepo()
    svc = _service(repo)
    with pytest.raises(BadRequestError):
        svc.create_edit_session(app_id="app-1", actor=actor, goal_text="edit it", model_config=MC)
    assert repo.created_fc is None  # never persisted


@pytest.mark.parametrize("scenario", ["build", "edit", "fix"])
def test_authorization_precedes_model_resolution(monkeypatch, actor, scenario):
    validate = Mock(return_value=MC)
    monkeypatch.setattr(service_mod, "validate_model_config", validate)
    repo = Mock()
    svc = DifyBuilderService(repo, Mock(), Mock(), authorize_app_fn=Mock(side_effect=NotFoundError()))
    kwargs = {"failed_run_id": "run-1"} if scenario == "fix" else {"goal_text": "Build it"}
    with pytest.raises(NotFoundError):
        getattr(svc, f"create_{scenario}_session")(app_id="app-1", actor=actor, **kwargs)
    validate.assert_not_called()
    repo.create_session.assert_not_called()


@pytest.mark.parametrize("scenario", ["build", "edit", "fix", "checklist"])
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("config", [None, MC])
def test_unavailable_model_rejected_before_session_subscription_or_dispatch(
    monkeypatch, actor, scenario, streaming, config
):
    validate = Mock(side_effect=ModelUnavailableError("unavailable"))
    monkeypatch.setattr(service_mod, "validate_model_config", validate)
    repo = Mock()
    lock = Mock()
    enqueue = Mock()
    subscribe = Mock()
    authorize = Mock()
    svc = DifyBuilderService(repo, lock, enqueue, subscribe_fn=subscribe, authorize_app_fn=authorize)
    mode = "fix" if scenario == "checklist" else scenario
    create = getattr(svc, f"create_{mode}_session{'_stream' if streaming else ''}")
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
