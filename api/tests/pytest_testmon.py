"""Keep tests that pytest-testmon cannot track in every pull request run.

testmon selects a test only when code that the test executed in the pytest process changed.
The files below read other modules as source text or run application code in a subprocess,
so a change to the code they check would not select them. Pull request CI runs them on every
change; add a file here when a test inspects source text or runs API code in a subprocess.
Paths are relative to the pytest root directory, `api/`.
"""

from __future__ import annotations

from typing import Protocol

import pytest

UNTRACKED_TEST_FILES = frozenset(
    {
        # Read other modules as source text.
        "providers/trace/trace-mlflow/tests/unit_tests/src/dify_trace_mlflow/test_provider.py",
        "tests/e2e_tests/contracts/test_config_overrides.py",
        "tests/unit_tests/controllers/console/datasets/test_data_source.py",
        "tests/unit_tests/controllers/console/knowledge_fs/test_resources.py",
        "tests/unit_tests/controllers/console/workspace/test_human_input_node_data_migration.py",
        "tests/unit_tests/controllers/service_api/dataset/rag_pipeline/test_rag_pipeline_workflow.py",
        "tests/unit_tests/core/human_input_v2/im_provider/test_feishu_lark_branches.py",
        "tests/unit_tests/core/human_input_v2/im_provider/test_message_locator_conformance.py",
        "tests/unit_tests/core/human_input_v2/im_provider/test_ms_teams_card_events.py",
        "tests/unit_tests/core/human_input_v2/test_im_sync_reconciliation_contract.py",
        "tests/unit_tests/core/human_input_v2/test_import_boundaries.py",
        "tests/unit_tests/core/rag/embedding/test_embedding_base.py",
        "tests/unit_tests/models/test_enums.py",
        "tests/unit_tests/repositories/knowledge/test_dataset_read_repository.py",
        "tests/unit_tests/services/billing_client/test_transport.py",
        "tests/unit_tests/services/knowledge/test_dataset_service.py",
        "tests/unit_tests/tasks/test_async_workflow_tasks.py",
        # Run API code in a subprocess.
        "providers/trace/trace-opik/tests/unit_tests/src/dify_trace_opik/test_provider.py",
        "providers/trace/trace-weave/tests/unit_tests/src/dify_trace_weave/test_provider.py",
        "tests/e2e_tests/contracts/core/workflow/test_node_mapping_bootstrap.py",
        "tests/unit_tests/core/human_input_v2/im_provider/test_slack_card_events.py",
        "tests/unit_tests/dev/test_cached_console_openapi.py",
        "tests/unit_tests/dev/test_generate_knowledge_fs_contract.py",
        "tests/unit_tests/dev/test_generate_swagger_specs.py",
        "tests/unit_tests/extensions/otel/test_instrumentation.py",
        "tests/unit_tests/schedule/test_check_upgradable_plugin_task.py",
        "tests/unit_tests/services/retention/workflow_run/test_archive_download_preparation.py",
        "tests/unit_tests/services/tracing/test_canonical.py",
    }
)


def keep_untracked_tests(config: pytest.Config) -> None:
    """Remove untracked test files from testmon's deselection before collection starts."""
    select = config.pluginmanager.get_plugin("TestmonSelect")
    if select is None:
        return
    # These lists are testmon internals; fail loudly if an upgrade renames them.
    message = "pytest-testmon changed its selection internals; update tests/pytest_testmon.py"
    try:
        lists = (select.deselected_files, select.deselected_tests)
    except AttributeError as error:
        raise pytest.UsageError(message) from error
    if not all(isinstance(names, list) for names in lists):
        raise pytest.UsageError(message)
    remove_untracked_from_selection(select)


class TestmonSelection(Protocol):
    """The deselection lists of pytest-testmon's `TestmonSelect` plugin."""

    deselected_files: list[str]
    deselected_tests: list[str]


def remove_untracked_from_selection(select: TestmonSelection) -> None:
    """Edit the deselection lists of pytest-testmon's `TestmonSelect` plugin in place."""
    # testmon skips stable files at collection and stable tests after it; clear both lists.
    select.deselected_files = [path for path in select.deselected_files if path not in UNTRACKED_TEST_FILES]
    select.deselected_tests = [
        nodeid for nodeid in select.deselected_tests if nodeid.split("::", 1)[0] not in UNTRACKED_TEST_FILES
    ]
