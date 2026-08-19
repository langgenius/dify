"""Registration test for the console workflow-copilot routes (P3c Task 6).

Proves that importing ``controllers.console`` (the package ``__init__``)
registers the ``workflow_copilot`` module and its five Flask-RESTX resources
on ``console_ns`` -- i.e. that the module is wired into the explicit
``from . import (...)`` block alongside its siblings (``feature``,
``human_input_form``, ``workflow_run_archive``), not just importable on its
own.
"""

import controllers.console as c
from controllers.console import console_ns


def test_importing_console_package_registers_workflow_copilot_module():
    # Importing controllers.console (already done at module load time, above)
    # must not raise, and must bind `workflow_copilot` as a package attribute.
    # `from . import workflow_copilot` (in controllers/console/__init__.py)
    # is what binds this -- a plain `import controllers.console.workflow_copilot`
    # elsewhere would NOT prove the package's own __init__ registers it, since
    # that would bind the attribute as a side effect of the submodule import
    # itself. Asserting it here, having imported only the package (not the
    # submodule directly), specifically proves the import block does it.
    assert hasattr(c, "workflow_copilot"), (
        "controllers.console.workflow_copilot must be imported by "
        "controllers/console/__init__.py's explicit `from . import (...)` block"
    )


def test_workflow_copilot_resource_classes_exist():
    mod = c.workflow_copilot
    for name in (
        "WorkflowCopilotSessionsApi",
        "WorkflowCopilotSessionApi",
        "WorkflowCopilotActionsApi",
        "WorkflowCopilotMessagesApi",
        "WorkflowCopilotStreamApi",
    ):
        assert hasattr(mod, name), f"{name} missing from controllers.console.workflow_copilot"


def test_workflow_copilot_paths_registered_on_console_ns():
    # console_ns.resources holds flask_restx.namespace.ResourceRoute namedtuples:
    # ResourceRoute(resource=<Resource class>, urls=(str, ...), route_doc={}, kwargs={}).
    # Verified by inspection: `console_ns.resources[0]` ->
    # ResourceRoute(resource=<class '...AppImportApi'>, urls=('/apps/imports',), ...).
    # We flatten every route's `urls` tuple and check the five copilot paths
    # are present as exact registered URLs (not a substring/joined-string
    # check, which could false-positive on an unrelated route).
    registered_urls = {url for route in console_ns.resources for url in route.urls}

    expected = {
        "/workflow-copilot/sessions",
        "/workflow-copilot/sessions/<string:session_id>",
        "/workflow-copilot/sessions/<string:session_id>/actions",
        "/workflow-copilot/sessions/<string:session_id>/messages",
        "/workflow-copilot/sessions/<string:session_id>/stream",
    }
    missing = expected - registered_urls
    assert not missing, f"copilot routes missing from console_ns.resources: {missing}"
