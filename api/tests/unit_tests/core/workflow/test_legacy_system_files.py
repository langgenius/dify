from core.workflow.legacy_system_files import (
    LegacySysFilesCompatVariable,
    attach_legacy_sys_files_warning,
    migrate_legacy_sys_files_graph_with_result,
    normalize_legacy_sys_files_args,
    resolve_legacy_sys_files_compat_variable,
)

_LEGACY_NODE_ID = "sys"
_LEGACY_ALIAS_NODE_ID = "userinput"
_LEGACY_VARIABLE_NAME = "files"
_LEGACY_SELECTOR = [_LEGACY_NODE_ID, _LEGACY_VARIABLE_NAME]
_LEGACY_TEMPLATE = "{{#" + ".".join((_LEGACY_NODE_ID, _LEGACY_VARIABLE_NAME)) + "#}}"
_LEGACY_ALIAS_SELECTOR = [_LEGACY_ALIAS_NODE_ID, _LEGACY_VARIABLE_NAME]
_LEGACY_ALIAS_TEMPLATE = "{{#" + ".".join((_LEGACY_ALIAS_NODE_ID, _LEGACY_VARIABLE_NAME)) + "#}}"
_LEGACY_ALIAS_INPUT_KEY = ".".join((_LEGACY_ALIAS_NODE_ID, _LEGACY_VARIABLE_NAME))


def test_migrate_legacy_sys_files_graph_ignores_invalid_or_unrelated_graphs():
    assert not migrate_legacy_sys_files_graph_with_result({}).changed
    assert not migrate_legacy_sys_files_graph_with_result({"nodes": [], "edges": [_LEGACY_SELECTOR]}).changed
    assert not migrate_legacy_sys_files_graph_with_result({"nodes": [{"data": {"value": ["sys", "query"]}}]}).changed


def test_migrate_legacy_sys_files_graph_rewrites_sys_files_to_userinput_files_without_start_variable():
    graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": [{"variable": "sys_files"}]}},
            {
                "id": "answer",
                "data": {
                    "type": "answer",
                    "answer": _LEGACY_SELECTOR,
                    "template": _LEGACY_TEMPLATE,
                },
            },
        ],
    }

    result = migrate_legacy_sys_files_graph_with_result(graph)

    assert result.changed
    start_data = result.graph["nodes"][0]["data"]
    assert start_data["variables"] == [{"variable": "sys_files"}]
    assert result.graph["nodes"][1]["data"]["answer"] == _LEGACY_ALIAS_SELECTOR
    assert result.graph["nodes"][1]["data"]["template"] == _LEGACY_ALIAS_TEMPLATE


def test_migrate_legacy_sys_files_graph_leaves_userinput_files_target_unchanged():
    graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "variables": []}},
            {
                "id": "answer",
                "data": {
                    "type": "answer",
                    "answer": _LEGACY_ALIAS_SELECTOR,
                    "template": _LEGACY_ALIAS_TEMPLATE,
                },
            },
        ],
    }

    result = migrate_legacy_sys_files_graph_with_result(graph)

    assert not result.changed
    assert result.graph == graph


def test_resolve_legacy_sys_files_compat_variable_returns_userinput_files_target():
    assert resolve_legacy_sys_files_compat_variable({}) is None
    assert resolve_legacy_sys_files_compat_variable({"nodes": [{"data": {"value": ["sys", "query"]}}]}) is None

    compat_variable = resolve_legacy_sys_files_compat_variable({"nodes": [{"data": {"value": _LEGACY_SELECTOR}}]})

    assert compat_variable == LegacySysFilesCompatVariable(
        start_node_id=_LEGACY_ALIAS_NODE_ID,
        variable_name=_LEGACY_VARIABLE_NAME,
    )
    assert (
        resolve_legacy_sys_files_compat_variable({"nodes": [{"data": {"value": _LEGACY_ALIAS_SELECTOR}}]})
        == compat_variable
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
    assert normalized_args["inputs"][".".join((compat_variable.start_node_id, compat_variable.variable_name))] == files


def test_normalize_legacy_sys_files_args_maps_userinput_files_to_top_level_files_without_warning():
    files = [{"id": "file-1"}]
    normalized_args, compat_variable = normalize_legacy_sys_files_args(
        graph={"nodes": [{"data": {"type": "answer", "answer": _LEGACY_ALIAS_TEMPLATE}}]},
        args={"inputs": {_LEGACY_ALIAS_INPUT_KEY: files}},
    )

    assert compat_variable is None
    assert normalized_args["files"] == files
    assert normalized_args["inputs"] == {_LEGACY_ALIAS_INPUT_KEY: files}


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
        LegacySysFilesCompatVariable(start_node_id=_LEGACY_ALIAS_NODE_ID, variable_name=_LEGACY_VARIABLE_NAME),
    )

    chunks = list(wrapped)

    assert "warning" in chunks[0]
    assert chunks[1] == "data: payload\n\n"
    assert stream.closed
