from core.app.apps.exc import GenerateTaskStoppedError


class TestAppsExceptions:
    def test_generate_task_stopped_error(self):
        err = GenerateTaskStoppedError("stopped")
        assert str(err) == "stopped"
