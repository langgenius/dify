import controllers.console.explore.trial as module
from controllers.console import console_ns


def test_trial_workflow_uses_trial_scoped_simple_account_model() -> None:
    assert module.simple_account_model.name == "TrialSimpleAccount"
    assert module.simple_account_model.__schema__["properties"].keys() >= {"id", "name", "email"}


def test_trial_routes_keep_paths_and_endpoints() -> None:
    expected = {
        "TrialAppFileUploadApi": (("/trial-apps/<uuid:app_id>/files/upload",), "trial_app_file_upload"),
        "TrialAppRemoteFileUploadApi": (
            ("/trial-apps/<uuid:app_id>/remote-files/upload",),
            "trial_app_remote_file_upload",
        ),
        "TrialAppWorkflowRunApi": (("/trial-apps/<uuid:app_id>/workflows/run",), "trial_app_workflow_run"),
        "TrialAppWorkflowTaskStopApi": (
            ("/trial-apps/<uuid:app_id>/workflows/tasks/<string:task_id>/stop",),
            None,
        ),
        "TrialChatApi": (("/trial-apps/<uuid:app_id>/chat-messages",), "trial_app_chat_completion"),
        "TrialMessageSuggestedQuestionApi": (
            ("/trial-apps/<uuid:app_id>/messages/<uuid:message_id>/suggested-questions",),
            "trial_app_suggested_question",
        ),
        "TrialChatAudioApi": (("/trial-apps/<uuid:app_id>/audio-to-text",), "trial_app_audio"),
        "TrialChatTextApi": (("/trial-apps/<uuid:app_id>/text-to-audio",), "trial_app_text"),
        "TrialCompletionApi": (("/trial-apps/<uuid:app_id>/completion-messages",), "trial_app_completion"),
        "TrialSitApi": (("/trial-apps/<uuid:app_id>/site",), None),
        "TrialAppParameterApi": (("/trial-apps/<uuid:app_id>/parameters",), "trial_app_parameters"),
        "AppApi": (("/trial-apps/<uuid:app_id>",), "trial_app"),
        "AppWorkflowApi": (("/trial-apps/<uuid:app_id>/workflows",), "trial_app_workflow"),
        "DatasetListApi": (("/trial-apps/<uuid:app_id>/datasets",), "trial_app_datasets"),
    }
    actual = {
        resource.__name__: (urls, kwargs.get("endpoint"))
        for resource, urls, _route_doc, kwargs in console_ns.resources
        if resource.__module__ == module.__name__
    }

    assert actual == expected
