"""Tests for Celery SQL comment context injection."""

from unittest.mock import MagicMock, patch

from opentelemetry import context


class TestBuildCelerySqlcommenterTags:
    """Tests for _build_celery_sqlcommenter_tags."""

    def test_includes_framework_and_task_name(self):
        """Tags include celery framework version and task name."""
        from extensions.otel.celery_sqlcommenter import _build_celery_sqlcommenter_tags

        task = MagicMock()
        task.name = "tasks.async_workflow_tasks.execute_workflow_team"
        task.request = MagicMock()
        task.request.retries = 0
        task.request.delivery_info = {}

        with patch("extensions.otel.celery_sqlcommenter._get_traceparent", return_value=None):
            tags = _build_celery_sqlcommenter_tags(task)

        assert "framework" in tags
        assert tags["framework"].startswith("celery:")
        assert tags["task_name"] == "tasks.async_workflow_tasks.execute_workflow_team"

    def test_includes_celery_retries_when_nonzero(self):
        """celery_retries is included when retries > 0."""
        from extensions.otel.celery_sqlcommenter import _build_celery_sqlcommenter_tags

        task = MagicMock()
        task.name = "tasks.my_task"
        task.request = MagicMock()
        task.request.retries = 3
        task.request.delivery_info = {}

        with patch("extensions.otel.celery_sqlcommenter._get_traceparent", return_value=None):
            tags = _build_celery_sqlcommenter_tags(task)

        assert tags["celery_retries"] == 3

    def test_omits_celery_retries_when_zero(self):
        """celery_retries is omitted when retries is 0."""
        from extensions.otel.celery_sqlcommenter import _build_celery_sqlcommenter_tags

        task = MagicMock()
        task.name = "tasks.my_task"
        task.request = MagicMock()
        task.request.retries = 0
        task.request.delivery_info = {}

        with patch("extensions.otel.celery_sqlcommenter._get_traceparent", return_value=None):
            tags = _build_celery_sqlcommenter_tags(task)

        assert "celery_retries" not in tags

    def test_includes_routing_key_from_delivery_info(self):
        """routing_key is included when present in delivery_info."""
        from extensions.otel.celery_sqlcommenter import _build_celery_sqlcommenter_tags

        task = MagicMock()
        task.name = "tasks.my_task"
        task.request = MagicMock()
        task.request.retries = 0
        task.request.delivery_info = {"routing_key": "workflow_based_app_execution"}

        with patch("extensions.otel.celery_sqlcommenter._get_traceparent", return_value=None):
            tags = _build_celery_sqlcommenter_tags(task)

        assert tags["routing_key"] == "workflow_based_app_execution"

    def test_includes_traceparent_when_available(self):
        """traceparent is included when injectable from current context."""
        from extensions.otel.celery_sqlcommenter import _build_celery_sqlcommenter_tags

        task = MagicMock()
        task.name = "tasks.my_task"
        task.request = MagicMock()
        task.request.retries = 0
        task.request.delivery_info = {}

        traceparent = "00-5db86c23fa8d05b67db315694b518684-737bbf30cdcda066-00"
        with patch(
            "extensions.otel.celery_sqlcommenter._get_traceparent",
            return_value=traceparent,
        ):
            tags = _build_celery_sqlcommenter_tags(task)

        assert tags["traceparent"] == traceparent

    def test_handles_task_without_request(self):
        """Gracefully handles task without request attribute."""
        from extensions.otel.celery_sqlcommenter import _build_celery_sqlcommenter_tags

        task = MagicMock()
        task.name = "tasks.my_task"
        del task.request

        with patch("extensions.otel.celery_sqlcommenter._get_traceparent", return_value=None):
            tags = _build_celery_sqlcommenter_tags(task)

        assert "framework" in tags
        assert "task_name" in tags


class TestTaskPrerunPostrunHandlers:
    """Tests for task_prerun and task_postrun signal handlers."""

    def test_prerun_sets_context_postrun_detaches(self):
        """task_prerun attaches SQLCOMMENTER context; task_postrun detaches it."""
        from extensions.otel.celery_sqlcommenter import (
            _SQLCOMMENTER_CONTEXT_KEY,
            _TOKEN_ATTR,
            _on_task_postrun,
            _on_task_prerun,
        )

        clean_ctx = context.set_value(_SQLCOMMENTER_CONTEXT_KEY, None)
        token = context.attach(clean_ctx)
        try:
            task = MagicMock()
            task.name = "tasks.async_workflow_tasks.execute_workflow_team"
            task.request = MagicMock()
            task.request.retries = 1
            task.request.delivery_info = {"routing_key": "workflow_based_app_execution"}

            with patch(
                "extensions.otel.celery_sqlcommenter._get_traceparent",
                return_value="00-abc123-def456-00",
            ):
                _on_task_prerun(task=task)

            tags = context.get_value(_SQLCOMMENTER_CONTEXT_KEY)
            assert tags is not None
            assert tags["framework"].startswith("celery:")
            assert tags["task_name"] == "tasks.async_workflow_tasks.execute_workflow_team"
            assert tags["celery_retries"] == 1
            assert tags["routing_key"] == "workflow_based_app_execution"
            assert tags["traceparent"] == "00-abc123-def456-00"
            assert hasattr(task, _TOKEN_ATTR)

            _on_task_postrun(task=task)

            tags_after = context.get_value(_SQLCOMMENTER_CONTEXT_KEY)
            assert tags_after is None
            assert not hasattr(task, _TOKEN_ATTR)
        finally:
            context.detach(token)

    def test_prerun_skips_when_no_task(self):
        """prerun does nothing when task is missing from kwargs."""
        from extensions.otel.celery_sqlcommenter import (
            _SQLCOMMENTER_CONTEXT_KEY,
            _on_task_prerun,
        )

        clean_ctx = context.set_value(_SQLCOMMENTER_CONTEXT_KEY, None)
        token = context.attach(clean_ctx)
        try:
            _on_task_prerun()
            tags = context.get_value(_SQLCOMMENTER_CONTEXT_KEY)
            assert tags is None
        finally:
            context.detach(token)

    def test_postrun_skips_when_no_token(self):
        """postrun does nothing when task has no token (e.g. prerun was skipped)."""
        from extensions.otel.celery_sqlcommenter import _on_task_postrun

        task = MagicMock()
        _on_task_postrun(task=task)
