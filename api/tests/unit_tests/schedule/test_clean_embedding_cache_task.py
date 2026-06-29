import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock


class FakeCelery:
    def task(self, **_kwargs):
        return lambda func: func


class FakeColumn:
    def __lt__(self, _other):
        return "older-than-cutoff"

    def desc(self):
        return "created-at-desc"


def load_clean_embedding_cache_task_module(monkeypatch):
    module_path = Path(__file__).parents[3] / "schedule" / "clean_embedding_cache_task.py"
    module_name = "test_clean_embedding_cache_task_module"

    monkeypatch.setitem(sys.modules, "app", SimpleNamespace(celery=FakeCelery()))
    monkeypatch.setitem(
        sys.modules,
        "configs",
        SimpleNamespace(dify_config=SimpleNamespace(PLAN_SANDBOX_CLEAN_DAY_SETTING="30")),
    )
    monkeypatch.setitem(sys.modules, "extensions.ext_database", SimpleNamespace(db=MagicMock()))
    monkeypatch.setitem(
        sys.modules,
        "models.dataset",
        SimpleNamespace(Embedding=SimpleNamespace(id=FakeColumn(), created_at=FakeColumn())),
    )

    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_clean_embedding_cache_task_uses_explicit_sqlalchemy_session(monkeypatch):
    module = load_clean_embedding_cache_task_module(monkeypatch)

    assert hasattr(module, "Session")

    engine = object()
    db = MagicMock()
    db.engine = engine
    monkeypatch.setattr(module, "db", db)
    monkeypatch.setattr(module.dify_config, "PLAN_SANDBOX_CLEAN_DAY_SETTING", "30")

    session = MagicMock()
    session.scalars.return_value.all.side_effect = [["embedding-1", "embedding-2"], []]

    session_context = MagicMock()
    session_context.__enter__.return_value = session
    session_context.__exit__.return_value = None

    session_cls = MagicMock(return_value=session_context)
    monkeypatch.setattr(module, "Session", session_cls)

    query = MagicMock()
    query.where.return_value = query
    query.order_by.return_value = query
    query.limit.return_value = query
    monkeypatch.setattr(module, "select", MagicMock(return_value=query))
    monkeypatch.setattr(module, "text", MagicMock(return_value="delete statement"))

    module.clean_embedding_cache_task()

    session_cls.assert_called_once_with(engine, expire_on_commit=False)
    assert session.execute.call_count == 2
    session.commit.assert_called_once()
