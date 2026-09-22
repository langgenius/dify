import controllers.console.explore.trial as module


def test_trial_workflow_uses_trial_scoped_simple_account_model() -> None:
    assert module.simple_account_model.name == "TrialSimpleAccount"
    assert module.simple_account_model.__schema__["properties"].keys() >= {"id", "name", "email"}
