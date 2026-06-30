import importlib

import pytest


def _load_session_binding_module():
    try:
        return importlib.import_module("core.workflow.human_input.session_binding")
    except ModuleNotFoundError as exc:
        pytest.fail(f"expected Dify-owned session binding module at 'core.workflow.human_input.session_binding': {exc}")


def test_session_binding_exports_class_and_singleton() -> None:
    module = _load_session_binding_module()

    assert hasattr(module, "SessionBinding")
    assert hasattr(module, "session_binding")
    assert isinstance(module.session_binding, module.SessionBinding)


@pytest.mark.parametrize(
    "form_id",
    [
        "form-1",
        "human-input/form-2",
        "tenant:workflow:node:form-3",
    ],
)
def test_session_binding_phase1_identity_round_trip(form_id: str) -> None:
    module = _load_session_binding_module()
    binding = module.session_binding

    session_id = binding.issue_session_id_for_form(form_id=form_id)

    assert session_id == form_id
    assert binding.resolve_form_id_from_session_id(session_id=session_id) == form_id
