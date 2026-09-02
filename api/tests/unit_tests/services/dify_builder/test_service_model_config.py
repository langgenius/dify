import pytest

from core.dify_builder.errors import BadRequestError
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
    monkeypatch.setattr(service_mod, "validate_model_config", lambda tenant_id, mc: None)  # noqa: ARG005
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


def test_build_session_defaults_empty_model_config(monkeypatch, actor):
    monkeypatch.setattr(
        service_mod.FeatureService,
        "get_features",
        staticmethod(lambda tenant_id: type("F", (), {"skill_learning_policy": "ask"})()),  # noqa: ARG005
    )
    repo = _FakeRepo()
    svc = _service(repo)
    monkeypatch.setattr(svc, "get_session_view", lambda sid, a: "VIEW")  # noqa: ARG005
    svc.create_build_session(app_id="app-1", actor=actor, goal_text="g")
    assert repo.created_fc.model_config == {}


def test_invalid_model_config_raises_before_persist(monkeypatch, actor):
    def boom(tenant_id, mc):  # noqa: ARG001
        raise BadRequestError("bad model")

    monkeypatch.setattr(service_mod, "validate_model_config", boom)
    repo = _FakeRepo()
    svc = _service(repo)
    with pytest.raises(BadRequestError):
        svc.create_edit_session(app_id="app-1", actor=actor, goal_text="edit it", model_config=MC)
    assert repo.created_fc is None  # never persisted
