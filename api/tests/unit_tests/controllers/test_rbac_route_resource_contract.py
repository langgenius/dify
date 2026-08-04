"""Guard against resource-scoped RBAC gates mounted on routes that carry no resource id.

``rbac_permission_required`` defaults to ``resource_required=True``, which makes
``_extract_resource_id`` raise ``ValueError`` when the matched path holds none of the
accepted identifiers. The request then fails with a 400 before the view ever runs, so the
endpoint is unreachable for every tenant with ``RBAC_ENABLED``. Creation endpoints and
other workspace-level actions must opt out with ``resource_required=False``.
"""

import ast
from pathlib import Path

CONTROLLERS_DIR = Path(__file__).resolve().parents[3] / "controllers"

# Mirrors the lookup order in controllers/common/wraps.py::_extract_resource_id.
ACCEPTED_PATH_ARGS = {
    "APP": ("app_id", "agent_id", "resource_id"),
    "DATASET": ("dataset_id", "pipeline_id", "resource_id"),
}

# Known violations tracked separately: DatasetDocumentSegmentBatchImportApi binds one class
# to both the dataset-scoped import route and the job-scoped status route, so every method
# on it is reachable at a path carrying only a job id. Its permission points are genuinely
# per-dataset, so it needs the route split rather than resource_required=False. Remove
# these entries with that fix.
KNOWN_VIOLATIONS = {
    ("console/datasets/datasets_segments.py", "DatasetDocumentSegmentBatchImportApi", "post"),
    ("console/datasets/datasets_segments.py", "DatasetDocumentSegmentBatchImportApi", "get"),
}


def _decorator_name(node: ast.Call) -> str:
    func = node.func
    parts = []
    while isinstance(func, ast.Attribute):
        parts.append(func.attr)
        func = func.value
    if isinstance(func, ast.Name):
        parts.append(func.id)
    return ".".join(reversed(parts))


def _attribute_name(node: ast.expr | None) -> str | None:
    return node.attr if isinstance(node, ast.Attribute) else None


def _route_paths(class_node: ast.ClassDef) -> list[str]:
    paths: list[str] = []
    for decorator in class_node.decorator_list:
        if isinstance(decorator, ast.Call) and _decorator_name(decorator).endswith(".route"):
            paths.extend(
                arg.value for arg in decorator.args if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
            )
    return paths


def _path_args(route: str) -> set[str]:
    args = set()
    args.update(segment.split(">")[0].split(":")[-1] for segment in route.split("<")[1:])
    return args


def _resource_scoped_gates(method: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    scopes = []
    for decorator in method.decorator_list:
        if not (isinstance(decorator, ast.Call) and _decorator_name(decorator).endswith("rbac_permission_required")):
            continue
        keywords = {keyword.arg: keyword.value for keyword in decorator.keywords}
        resource_required = keywords.get("resource_required")
        if isinstance(resource_required, ast.Constant) and resource_required.value is False:
            continue
        scope = _attribute_name(decorator.args[0] if decorator.args else keywords.get("resource_type"))
        if scope in ACCEPTED_PATH_ARGS:
            scopes.append(scope)
    return scopes


def test_resource_scoped_rbac_gates_have_a_resource_id_in_the_route() -> None:
    violations = []

    for path in sorted(CONTROLLERS_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for class_node in (node for node in ast.walk(tree) if isinstance(node, ast.ClassDef)):
            routes = _route_paths(class_node)
            if not routes:
                continue
            methods = (node for node in class_node.body if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef))
            for method in methods:
                for scope in _resource_scoped_gates(method):
                    accepted = set(ACCEPTED_PATH_ARGS[scope])
                    unscoped = [route for route in routes if not _path_args(route) & accepted]
                    if not unscoped:
                        continue
                    key = (path.relative_to(CONTROLLERS_DIR).as_posix(), class_node.name, method.name)
                    if key in KNOWN_VIOLATIONS:
                        continue
                    violations.append(f"{key[0]}::{key[1]}.{key[2]} scope={scope} routes={unscoped}")

    assert not violations, (
        "resource-scoped rbac_permission_required on routes without a resource id; "
        "pass resource_required=False for workspace-level actions:\n" + "\n".join(violations)
    )
