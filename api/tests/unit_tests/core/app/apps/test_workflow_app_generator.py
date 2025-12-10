from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY, WorkflowAppGenerator


def test_should_prepare_user_inputs_defaults_to_true():
    args = {"inputs": {}}

    assert WorkflowAppGenerator()._should_prepare_user_inputs(args)


def test_should_prepare_user_inputs_skips_when_flag_truthy():
    args = {"inputs": {}, SKIP_PREPARE_USER_INPUTS_KEY: True}

    assert not WorkflowAppGenerator()._should_prepare_user_inputs(args)


def test_should_prepare_user_inputs_keeps_validation_when_flag_false():
    args = {"inputs": {}, SKIP_PREPARE_USER_INPUTS_KEY: False}

    assert WorkflowAppGenerator()._should_prepare_user_inputs(args)
