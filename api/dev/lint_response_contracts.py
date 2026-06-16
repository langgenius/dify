"""Lint Flask-RESTX response docs against statically visible response serializers.

This checker intentionally stays conservative. It only reports a hard schema
mismatch when both sides are statically known for the same 2xx status code:
a documented ``@ns.response(..., Model)`` and an actual ``dump_response(Model, ...)``
or ``Model.model_validate(...).model_dump()`` return.

Raw dictionaries, raw lists, ``None`` responses, streaming helpers, missing
response schemas, and returns with non-literal status codes are classified as
unknown. Unknown details are hidden by default to keep routine output focused;
pass ``--include-unknown`` when triaging them. The one intentional non-schema
mismatch is a known body/schema on a no-body status such as 204, 205, or 304.
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from http import HTTPStatus
from pathlib import Path
from typing import Any, Literal

HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put"}
NO_BODY_STATUSES = {HTTPStatus.NO_CONTENT.value, HTTPStatus.RESET_CONTENT.value, HTTPStatus.NOT_MODIFIED.value}
DEFAULT_CONTROLLER_DIRS = ("controllers/console", "controllers/service_api", "controllers/web")

type Classification = Literal["valid", "mismatch", "unknown", "refactorable"]
type ActualKind = Literal[
    "empty",
    "model",
    "model_dump_variable",
    "none",
    "raw_dict",
    "raw_list",
    "raw_value",
    "unknown",
]
type MethodNode = ast.FunctionDef | ast.AsyncFunctionDef

HTTP_STATUS_NAMES = {status.name: status.value for status in HTTPStatus}
HTTP_STATUS_NAMES.update({f"HTTP_{status.value}_{status.name}": status.value for status in HTTPStatus})


@dataclass(frozen=True)
class DocumentedResponse:
    status: int
    model: str | None
    line: int


@dataclass(frozen=True)
class ActualResponse:
    status: int | None
    kind: ActualKind
    model: str | None
    line: int


@dataclass(frozen=True)
class ContractCheck:
    classification: Classification
    file: str
    class_name: str
    method: str
    route: str
    line: int
    reason: str
    documented: dict[int, str | None]
    actual: list[ActualResponse]


@dataclass(frozen=True)
class ContractCheckContext:
    """Stable route-method context shared by every classification result."""

    file: str
    class_name: str
    method: str
    route: str
    line: int
    documented: dict[int, str | None]

    def build(
        self, classification: Classification, reason: str, actual_responses: Sequence[ActualResponse]
    ) -> ContractCheck:
        return ContractCheck(
            classification=classification,
            file=self.file,
            class_name=self.class_name,
            method=self.method,
            route=self.route,
            line=self.line,
            reason=reason,
            documented=self.documented,
            actual=list(actual_responses),
        )

    def mismatch(self, reason: str, documented: DocumentedResponse, actual: ActualResponse) -> ContractCheck:
        return self.build("mismatch", f"{reason} (doc line {documented.line}, return line {actual.line})", [actual])


@dataclass
class VariableAssignmentSummary:
    """Track whether a local name is safe to treat as one specific response model."""

    known_models: set[str] = field(default_factory=set)
    has_unknown_assignment: bool = False

    def add_known(self, model: str) -> None:
        self.known_models.add(model)

    def add_unknown(self) -> None:
        self.has_unknown_assignment = True

    def single_known_model(self) -> str | None:
        if self.has_unknown_assignment or len(self.known_models) != 1:
            return None
        return next(iter(self.known_models))


def dotted_name(node: ast.AST) -> str | None:
    match node:
        case ast.Name():
            return node.id
        case ast.Attribute():
            parent = dotted_name(node.value)
            if parent:
                return f"{parent}.{node.attr}"
            return node.attr
    return None


def leaf_name(node: ast.AST) -> str | None:
    name = dotted_name(node)
    if name is None:
        return None
    return name.rsplit(".", 1)[-1]


def int_constant(node: ast.AST | None) -> int | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return node.value
    if isinstance(node, ast.Name):
        return HTTP_STATUS_NAMES.get(node.id)
    if isinstance(node, ast.Attribute):
        return HTTP_STATUS_NAMES.get(node.attr)
    return None


def string_constant(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def keyword_value(call: ast.Call, *names: str) -> ast.AST | None:
    for keyword in call.keywords:
        if keyword.arg in names:
            return keyword.value
    return None


def is_probable_model_name(name: str) -> bool:
    return bool(name) and name[0].isupper()


def model_name_from_schema_expr(node: ast.AST | None) -> str | None:
    if node is None:
        return None

    if isinstance(node, ast.Subscript):
        value_name = dotted_name(node.value)
        if value_name and value_name.endswith(".models"):
            # register_response_schema_models stores schemas by model name; both
            # ns.models[Model.__name__] and ns.models["Model"] appear in controllers.
            key = node.slice
            if isinstance(key, ast.Attribute) and key.attr == "__name__":
                return leaf_name(key.value)
            return string_constant(key)

    if isinstance(node, ast.Call):
        func_name = dotted_name(node.func)
        if func_name and func_name.endswith(".model"):
            return string_constant(node.args[0] if node.args else keyword_value(node, "name"))

    if isinstance(node, ast.Name):
        return node.id

    return None


def documented_response_from_decorator(decorator: ast.expr) -> DocumentedResponse | None:
    if not isinstance(decorator, ast.Call):
        return None

    func_name = dotted_name(decorator.func)
    if not func_name or not func_name.endswith(".response"):
        return None

    status_expr = decorator.args[0] if decorator.args else keyword_value(decorator, "code", "status")
    status = int_constant(status_expr)
    if status is None:
        return None

    schema_expr: ast.AST | None = decorator.args[2] if len(decorator.args) >= 3 else None
    schema_expr = keyword_value(decorator, "model", "schema") or schema_expr

    return DocumentedResponse(
        status=status,
        model=model_name_from_schema_expr(schema_expr),
        line=decorator.lineno,
    )


def route_from_decorator(decorator: ast.expr) -> str | None:
    if not isinstance(decorator, ast.Call):
        return None

    func_name = dotted_name(decorator.func)
    if not func_name or not func_name.endswith(".route"):
        return None

    return string_constant(decorator.args[0] if decorator.args else keyword_value(decorator, "route", "path"))


def routes_from_decorators(decorators: Iterable[ast.expr]) -> list[str]:
    return [route for decorator in decorators if (route := route_from_decorator(decorator))]


def response_docs_from_decorators(decorators: Iterable[ast.expr]) -> dict[int, DocumentedResponse]:
    docs: dict[int, DocumentedResponse] = {}
    for decorator in decorators:
        response = documented_response_from_decorator(decorator)
        if response and 200 <= response.status < 300:
            docs[response.status] = response
    return docs


def model_name_from_model_validate_call(node: ast.AST) -> str | None:
    if not isinstance(node, ast.Call):
        return None
    if isinstance(node.func, ast.Attribute) and node.func.attr == "model_validate":
        return leaf_name(node.func.value)
    return None


def model_name_from_constructor_call(node: ast.AST) -> str | None:
    if not isinstance(node, ast.Call):
        return None
    if isinstance(node.func, ast.Name) and is_probable_model_name(node.func.id):
        return node.func.id
    return None


def model_name_from_model_dump(node: ast.AST) -> str | None:
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute) or node.func.attr != "model_dump":
        return None

    dumped_value = node.func.value
    if isinstance(dumped_value, ast.Call):
        return model_name_from_model_validate_call(dumped_value) or model_name_from_constructor_call(dumped_value)

    return None


def model_name_from_model_value(node: ast.AST) -> str | None:
    return model_name_from_model_validate_call(node) or model_name_from_constructor_call(node)


def model_name_from_dump_response(node: ast.AST) -> str | None:
    if not isinstance(node, ast.Call):
        return None

    func_name = dotted_name(node.func)
    if func_name != "dump_response" and not (func_name and func_name.endswith(".dump_response")):
        return None

    model_expr = node.args[0] if node.args else keyword_value(node, "model", "schema", "response_model")
    if isinstance(model_expr, ast.Name):
        return model_expr.id
    return None


def actual_kind_from_expr(
    expr: ast.AST | None, variable_models: dict[str, str] | None = None
) -> tuple[ActualKind, str | None]:
    if expr is None:
        return "none", None

    dump_response_model = model_name_from_dump_response(expr)
    if dump_response_model:
        return "model", dump_response_model

    if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Attribute) and expr.func.attr == "model_dump":
        dumped_value = expr.func.value
        if isinstance(dumped_value, ast.Name) and variable_models:
            # A variable dump can match today, but it bypasses dump_response and
            # is easier to drift; keep it visible as refactorable.
            model_name = variable_models.get(dumped_value.id)
            if model_name:
                return "model_dump_variable", model_name

    model_dump_model = model_name_from_model_dump(expr)
    if model_dump_model:
        return "model", model_dump_model

    if isinstance(expr, ast.Constant):
        if expr.value is None:
            return "none", None
        if expr.value == "":
            return "empty", None
        return "raw_value", None

    if isinstance(expr, ast.Dict):
        return "raw_dict", None

    if isinstance(expr, ast.List):
        return "raw_list", None

    return "unknown", None


def actual_response_from_return(return_node: ast.Return, variable_models: dict[str, str]) -> ActualResponse:
    status: int | None = 200
    body_expr = return_node.value

    if isinstance(return_node.value, ast.Tuple) and return_node.value.elts:
        body_expr = return_node.value.elts[0]
        if len(return_node.value.elts) >= 2:
            # Dynamic statuses are not safe to coerce to 200; classify them as unknown.
            status = int_constant(return_node.value.elts[1])

    kind, model = actual_kind_from_expr(body_expr, variable_models)
    return ActualResponse(status=status, kind=kind, model=model, line=return_node.lineno)


def iter_method_nodes(method: MethodNode) -> Iterable[ast.AST]:
    """Yield method body nodes while ignoring nested function/class scopes."""

    stack: list[ast.AST] = list(reversed(method.body))
    while stack:
        node = stack.pop()
        yield node

        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda | ast.ClassDef):
            continue

        stack.extend(reversed(list(ast.iter_child_nodes(node))))


def target_names(target: ast.AST) -> Iterable[str]:
    if isinstance(target, ast.Name):
        yield target.id
    elif isinstance(target, ast.Tuple | ast.List):
        for item in target.elts:
            yield from target_names(item)


def record_assignment(
    assignments: defaultdict[str, VariableAssignmentSummary], targets: Iterable[str], model_name: str | None
) -> None:
    for target in targets:
        if model_name is None:
            # Once a name receives an unknown value, later model_dump() calls on it
            # are no longer a reliable signal for the returned schema.
            assignments[target].add_unknown()
        else:
            assignments[target].add_known(model_name)


def variable_model_assignments_for_method(method: MethodNode) -> dict[str, str]:
    """Infer local variables that are unambiguously assigned one response model."""

    assignments: defaultdict[str, VariableAssignmentSummary] = defaultdict(VariableAssignmentSummary)

    for node in iter_method_nodes(method):
        match node:
            case ast.Assign(targets=targets, value=value):
                record_assignment(
                    assignments,
                    (name for target in targets for name in target_names(target)),
                    model_name_from_model_value(value),
                )
            case ast.AnnAssign(target=target, value=value) if value is not None:
                record_assignment(assignments, target_names(target), model_name_from_model_value(value))
            case ast.AugAssign(target=target) | ast.For(target=target) | ast.AsyncFor(target=target):
                # Mutation and loop targets overwrite prior values with runtime-dependent data.
                record_assignment(assignments, target_names(target), None)
            case ast.With(items=items) | ast.AsyncWith(items=items):
                for item in items:
                    if item.optional_vars is not None:
                        record_assignment(assignments, target_names(item.optional_vars), None)
            case ast.ExceptHandler(name=name) if name:
                assignments[name].add_unknown()
            case ast.NamedExpr(target=target, value=value):
                record_assignment(assignments, target_names(target), model_name_from_model_value(value))

    return {name: model for name, summary in assignments.items() if (model := summary.single_known_model()) is not None}


def actual_responses_for_method(method: MethodNode) -> list[ActualResponse]:
    """Extract statically visible 2xx returns from one controller method.

    The analysis is deliberately shallow and conservative:

    1. Walk only the method's own body, skipping nested functions/classes.
    2. Infer local variables that are assigned exactly one recognizable response
       model, so ``response.model_dump()`` can still be connected to its schema.
    3. Treat any later unknown assignment, mutation target, loop target, context
       manager binding, or exception binding as invalidating that variable.
    4. For each top-level return path, split Flask-style ``(body, status)``
       tuples, classify the body expression, and keep non-literal statuses as
       ``None`` so the classifier reports them as unknown instead of assuming 200.
    5. Drop non-2xx literal statuses, since response contracts here only compare
       successful response schemas.
    """

    variable_models = variable_model_assignments_for_method(method)
    responses: list[ActualResponse] = []
    for node in iter_method_nodes(method):
        if isinstance(node, ast.Return):
            responses.append(actual_response_from_return(node, variable_models))
    return [response for response in responses if response.status is None or 200 <= response.status < 300]


def display_path(file_path: Path, repo_root: Path) -> str:
    try:
        return str(file_path.relative_to(repo_root))
    except ValueError:
        return str(file_path)


def classify_method(
    *,
    actual_responses: Sequence[ActualResponse],
    class_name: str,
    documented_responses: dict[int, DocumentedResponse],
    file_path: Path,
    method: MethodNode,
    repo_root: Path,
    route: str,
) -> ContractCheck:
    documented_summary = {status: response.model for status, response in sorted(documented_responses.items())}
    context = ContractCheckContext(
        file=display_path(file_path, repo_root),
        class_name=class_name,
        method=method.name,
        route=route,
        line=method.lineno,
        documented=documented_summary,
    )

    if not actual_responses:
        return context.build("unknown", "no statically visible 2xx return", [])

    unknown_reasons: list[str] = []
    refactorable_reasons: list[str] = []

    for actual in actual_responses:
        if actual.status is None:
            unknown_reasons.append(f"return line {actual.line} has non-literal or unsupported status")
            continue

        documented = documented_responses.get(actual.status)

        if actual.status in NO_BODY_STATUSES:
            # No-body statuses are contract violations even when the schema names
            # would otherwise match, because clients should not expect a payload.
            if documented is not None and documented.model is not None:
                return context.mismatch(
                    f"status {actual.status} is a no-body response but documents {documented.model}",
                    documented,
                    actual,
                )
            if actual.kind in {"model", "model_dump_variable", "raw_dict", "raw_list", "raw_value"}:
                no_body_doc = DocumentedResponse(status=actual.status, model=None, line=method.lineno)
                return context.mismatch(
                    f"status {actual.status} is a no-body response but returns {actual.kind}",
                    no_body_doc,
                    actual,
                )
            if actual.kind == "unknown":
                unknown_reasons.append(f"status {actual.status} returns unknown body expression")
            continue

        if documented is None:
            unknown_reasons.append(f"status {actual.status} has no @response doc")
            continue

        if documented.model is None:
            unknown_reasons.append(f"status {actual.status} response doc has no schema model")
            continue

        if actual.kind == "model_dump_variable" and actual.model is not None:
            if documented.model != actual.model:
                return context.mismatch(
                    f"status {actual.status} documents {documented.model} but returns {actual.model}",
                    documented,
                    actual,
                )
            # The schema matches, but this path still deserves cleanup because
            # dump_response is the contract-aware serialization helper.
            refactorable_reasons.append(
                f"status {actual.status} returns {actual.model}.model_dump() through a variable; prefer dump_response"
            )
            continue

        if actual.kind != "model" or actual.model is None:
            unknown_reasons.append(f"status {actual.status} returns {actual.kind}")
            continue

        if documented.model != actual.model:
            return context.mismatch(
                f"status {actual.status} documents {documented.model} but returns {actual.model}",
                documented,
                actual,
            )

    if unknown_reasons:
        # Unknown beats refactorable: if any return path is ambiguous, do not
        # imply the endpoint is merely a cleanup candidate.
        return context.build("unknown", "; ".join(sorted(set(unknown_reasons))), actual_responses)

    if refactorable_reasons:
        return context.build("refactorable", "; ".join(sorted(set(refactorable_reasons))), actual_responses)

    return context.build(
        "valid",
        "documented response schema matches statically visible return schema",
        actual_responses,
    )


def iter_controller_files(paths: Iterable[Path]) -> Iterable[Path]:
    for path in paths:
        if path.is_file() and path.suffix == ".py":
            yield path
        elif path.is_dir():
            yield from sorted(child for child in path.rglob("*.py") if child.is_file())


def checks_for_file(file_path: Path, repo_root: Path) -> list[ContractCheck]:
    module = ast.parse(file_path.read_text(encoding="utf-8"), filename=str(file_path))
    checks: list[ContractCheck] = []

    for node in module.body:
        if not isinstance(node, ast.ClassDef):
            continue

        class_routes = routes_from_decorators(node.decorator_list)
        class_documented = response_docs_from_decorators(node.decorator_list)

        for item in node.body:
            if not isinstance(item, ast.FunctionDef | ast.AsyncFunctionDef) or item.name not in HTTP_METHODS:
                continue

            routes = routes_from_decorators(item.decorator_list) or class_routes
            if not routes:
                continue

            documented = {**class_documented, **response_docs_from_decorators(item.decorator_list)}
            # Method-level @response decorators override class-level defaults for
            # the same status code, matching Flask-RESTX's common controller style.
            actual = actual_responses_for_method(item)
            for route in routes:
                checks.append(
                    classify_method(
                        actual_responses=actual,
                        class_name=node.name,
                        documented_responses=documented,
                        file_path=file_path,
                        method=item,
                        repo_root=repo_root,
                        route=route,
                    )
                )

    return checks


def as_jsonable(check: ContractCheck) -> dict[str, Any]:
    data = asdict(check)
    data["documented"] = {str(status): model for status, model in check.documented.items()}
    return data


def print_text_report(checks: Sequence[ContractCheck], *, include_unknown: bool, include_valid: bool) -> None:
    counts = Counter(check.classification for check in checks)
    sys.stdout.write(
        "Response contract lint: "
        f"{counts['valid']} valid, "
        f"{counts['mismatch']} mismatch, "
        f"{counts['refactorable']} refactorable, "
        f"{counts['unknown']} unknown\n"
    )

    for classification in ("mismatch", "refactorable", "unknown", "valid"):
        filtered = [check for check in checks if check.classification == classification]
        if classification == "unknown" and not include_unknown:
            continue
        if classification == "valid" and not include_valid:
            continue
        if not filtered:
            continue

        sys.stdout.write(f"\n{classification.upper()}:\n")
        for check in filtered:
            location = f"{check.file}:{check.line} {check.class_name}.{check.method.upper()} {check.route}"
            sys.stdout.write(f"- {location}: {check.reason}\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="*",
        help="Files or directories to lint. Defaults to Flask controller directories.",
    )
    parser.add_argument("--include-unknown", action="store_true", help="Print unknown route methods in output.")
    parser.add_argument("--include-valid", action="store_true", help="Print valid route methods in text output.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    parser.add_argument(
        "--fail-on-mismatch",
        action="store_true",
        help="Treat mismatched response contracts as failures. By default this linter is report-only.",
    )
    parser.add_argument(
        "--fail-on-unknown",
        action="store_true",
        help="Treat unknown route methods as failures. By default this linter is report-only.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_root = Path(__file__).resolve().parents[1]
    repo_root = api_root.parent
    raw_paths = args.paths or list(DEFAULT_CONTROLLER_DIRS)
    paths = [path if path.is_absolute() else api_root / path for path in map(Path, raw_paths)]

    checks: list[ContractCheck] = []
    for file_path in iter_controller_files(paths):
        checks.extend(checks_for_file(file_path.resolve(), repo_root))

    checks.sort(key=lambda check: (check.classification, check.file, check.line, check.method))

    if args.json:
        grouped = defaultdict(list)
        for check in checks:
            if check.classification == "unknown" and not args.include_unknown:
                continue
            grouped[check.classification].append(as_jsonable(check))
        sys.stdout.write(f"{json.dumps(grouped, indent=2, sort_keys=True)}\n")
    else:
        print_text_report(
            checks,
            include_unknown=bool(args.include_unknown),
            include_valid=bool(args.include_valid),
        )

    has_mismatch = any(check.classification == "mismatch" for check in checks)
    has_unknown = any(check.classification == "unknown" for check in checks)
    return int((bool(args.fail_on_mismatch) and has_mismatch) or (bool(args.fail_on_unknown) and has_unknown))


if __name__ == "__main__":
    raise SystemExit(main())
