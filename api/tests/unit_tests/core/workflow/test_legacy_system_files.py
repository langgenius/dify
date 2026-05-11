from core.workflow.legacy_system_files import (
    LegacySysFilesCompatVariable,
    attach_legacy_sys_files_warning,
    migrate_legacy_sys_files_graph_with_result,
    normalize_legacy_sys_files_args,
    resolve_legacy_sys_files_compat_variable,
)

_LEGACY_NODE_ID = "sys"
_LEGACY_VARIABLE_NAME = "files"
_LEGACY_SELECTOR = [_LEGACY_NODE_ID, _LEGACY_VARIABLE_NAME]
_LEGACY_TEMPLATE = "{{#" + ".".join((_LEGACY_NODE_ID, _LEGACY_VARIABLE_NAME)) + "#}}"


def test_migrate_legacy_sys_files_graph_ignores_invalid_or_unrelated_graphs():
    assert not migrate_legacy_sys_files_graph_with_result({}).changed
    assert not migrate_legacy_sys_files_graph_with_result({"nodes": [], "edges": [_LEGACY_SELECTOR]}).changed
    assert not migrate_legacy_sys_files_graph_with_result({"nodes": [{"data": {"value": _LEGACY_SELECTOR}}]}).changed
    assert not migrate_legacy_sys_files_graph_with_result(
        {"nodes": [{"id": 1, "data": {"type": "start"}}, {"data": {"value": _LEGACY_SELECTOR}}]}
    ).changed


def test_migrate_legacy_sys_files_graph_creates_collision_free_file_input_from_features():
    graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": [{"variable": "sys_files"}]}},
            {"id": "answer", "data": {"type": "answer", "answer": _LEGACY_SELECTOR}},
        ],
    }

    result = migrate_legacy_sys_files_graph_with_result(
        graph,
        features={
            "file_upload": {
                "enabled": True,
                "allowed_file_upload_methods": ["remote_url"],
                "allowed_file_types": ["image"],
                "allowed_file_extensions": [".png"],
                "number_limits": 9,
            }
        },
    )

    assert result.changed
    start_data = result.graph["nodes"][0]["data"]
    created_variable = start_data["variables"][1]
    assert created_variable["variable"] == "sys_files_1"
    assert created_variable["allowed_file_upload_methods"] == ["remote_url"]
    assert created_variable["allowed_file_types"] == ["image"]
    assert created_variable["allowed_file_extensions"] == [".png"]
    assert created_variable["max_length"] == 9
    assert result.graph["nodes"][1]["data"]["answer"] == ["start", "sys_files_1"]


def test_resolve_legacy_sys_files_compat_variable_handles_missing_start_variable():
    assert resolve_legacy_sys_files_compat_variable({}) is None
    assert resolve_legacy_sys_files_compat_variable({"nodes": [1, {"data": {"value": _LEGACY_SELECTOR}}]}) is None
    assert (
        resolve_legacy_sys_files_compat_variable(
            {"nodes": [{"id": 1, "data": {"type": "start"}}, {"data": {"value": _LEGACY_SELECTOR}}]}
        )
        is None
    )
    assert (
        resolve_legacy_sys_files_compat_variable(
            {"nodes": [{"id": "start", "data": {"type": "start", "variables": []}}]}
        )
        is None
    )


def test_normalize_legacy_sys_files_args_handles_no_compat_and_top_level_files():
    args_without_legacy, compat_without_legacy = normalize_legacy_sys_files_args(
        graph={"nodes": []},
        args={"inputs": {}},
    )
    assert args_without_legacy == {"inputs": {}}
    assert compat_without_legacy is None

    files = [{"id": "file-1"}]
    graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": []}},
            {"id": "answer", "data": {"type": "answer", "answer": _LEGACY_TEMPLATE}},
        ],
    }
    normalized_args, compat_variable = normalize_legacy_sys_files_args(
        graph=graph,
        args={"inputs": {}, "files": files},
    )

    assert compat_variable is not None
    assert normalized_args["files"] == files
    assert normalized_args["inputs"][compat_variable.variable_name] == files


def test_attach_legacy_sys_files_warning_wraps_stream_and_closes_source():
    class CloseableStream:
        closed = False

        def __iter__(self):
            yield "data: payload\n\n"

        def close(self):
            self.closed = True

    stream = CloseableStream()
    wrapped = attach_legacy_sys_files_warning(
        stream,
        LegacySysFilesCompatVariable(start_node_id="start", variable_name="generated_files_input"),
    )

    chunks = list(wrapped)

    assert "warning" in chunks[0]
    assert chunks[1] == "data: payload\n\n"
    assert stream.closed
