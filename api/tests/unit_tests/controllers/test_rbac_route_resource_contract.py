"""Guard against resource-scoped RBAC gates mounted on routes their locator can't read.

Every RBAC gate is declared as one or more explicit ``RBACCheck(scene, Locator(...))``
bundles, via ``rbac_permission_required(RBACCheck(...), ...)`` or
``console_account_admission(rbac_checks=[RBACCheck(...), ...])``. Each locator reads a
path parameter — its explicit ``param`` argument, or its class default (``PlainApp`` reads
``app_id``, ``DatasetId`` reads ``dataset_id``, etc.; ``Workspace`` reads none). A route
whose URL doesn't carry that parameter can never resolve the check.
"""

import ast
from pathlib import Path

CONTROLLERS_DIR = Path(__file__).resolve().parents[3] / "controllers"

# Locator classes usable inside an RBACCheck(scene, Locator(...)), and the path parameter
# each reads when built with no argument (_ParamLocator.default_param in
# controllers/common/rbac/locators.py). Workspace maps to None: it reads no path parameter.
LOCATOR_DEFAULT_PARAMS = {
    "Workspace": None,
    "AgentId": "agent_id",
    "PlainApp": "app_id",
    "AgentBehindApp": "app_id",
    "DatasetId": "dataset_id",
    "DatasetByPipeline": "pipeline_id",
}

# Known violations tracked separately: DatasetDocumentSegmentBatchImportApi binds one class
# to both the dataset-scoped import route and the job-scoped status route, so every method
# on it is reachable at a path carrying only a job id. Its permission points are genuinely
# per-dataset, so it needs the route split rather than a Workspace() locator. Remove these
# entries with that fix.
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


def _locator_param(node: ast.expr) -> tuple[str, str | None] | None:
    """For a `Locator(...)` construction expression, return (locator class name, required
    path parameter). The required parameter is None for a locator that reads no path
    parameter (``Workspace``) or that this test doesn't recognize."""
    if not isinstance(node, ast.Call):
        return None
    name = _decorator_name(node)
    if name not in LOCATOR_DEFAULT_PARAMS:
        return None
    if node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
        return name, node.args[0].value
    for keyword in node.keywords:
        if keyword.arg == "param" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
            return name, keyword.value.value
    return name, LOCATOR_DEFAULT_PARAMS[name]


def _rbac_checks_from_exprs(exprs: list[ast.expr]) -> list[tuple[str, str]]:
    """Return (locator class name, required path parameter) for each `RBACCheck(scene,
    Locator("param"))` expression, skipping locators that need no path parameter or that
    this test doesn't recognize."""
    found = []
    for element in exprs:
        if not (isinstance(element, ast.Call) and _decorator_name(element).endswith("RBACCheck")):
            continue
        locator_arg = (
            element.args[1]
            if len(element.args) > 1
            else next((keyword.value for keyword in element.keywords if keyword.arg == "locator"), None)
        )
        if locator_arg is None:
            continue
        parsed = _locator_param(locator_arg)
        if parsed is None or parsed[1] is None:
            continue
        found.append(parsed)
    return found


def _resource_scoped_check_bundles(method: ast.FunctionDef | ast.AsyncFunctionDef) -> list[tuple[str, str]]:
    """Return (locator class name, required path parameter) for every RBACCheck gating this
    method, from `rbac_permission_required(RBACCheck(...), ...)` or
    `console_account_admission(rbac_checks=[RBACCheck(...), ...])`."""
    found = []
    for decorator in method.decorator_list:
        if not isinstance(decorator, ast.Call):
            continue
        name = _decorator_name(decorator)
        if name.endswith("rbac_permission_required"):
            found.extend(_rbac_checks_from_exprs(decorator.args))
        elif name.endswith("console_account_admission"):
            checks_list = next((keyword.value for keyword in decorator.keywords if keyword.arg == "rbac_checks"), None)
            if isinstance(checks_list, ast.List):
                found.extend(_rbac_checks_from_exprs(checks_list.elts))
    return found


def _violations_in_tree(tree: ast.Module, *, file_label: str) -> list[str]:
    violations = []
    for class_node in (node for node in ast.walk(tree) if isinstance(node, ast.ClassDef)):
        routes = _route_paths(class_node)
        if not routes:
            continue
        methods = (node for node in class_node.body if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef))
        for method in methods:
            key = (file_label, class_node.name, method.name)
            if key in KNOWN_VIOLATIONS:
                continue

            for locator_name, required_param in _resource_scoped_check_bundles(method):
                unscoped = [route for route in routes if required_param not in _path_args(route)]
                if unscoped:
                    violations.append(
                        f"{key[0]}::{key[1]}.{key[2]} locator={locator_name}({required_param!r}) routes={unscoped}"
                    )
    return violations


def test_resource_scoped_rbac_gates_have_a_resource_id_in_the_route() -> None:
    violations = []

    for path in sorted(CONTROLLERS_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        violations.extend(_violations_in_tree(tree, file_label=path.relative_to(CONTROLLERS_DIR).as_posix()))

    assert not violations, "RBACCheck locator on a route that doesn't carry its required path parameter:\n" + "\n".join(
        violations
    )
