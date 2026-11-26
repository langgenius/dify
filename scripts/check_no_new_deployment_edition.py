"""Reject new deployment-edition dependencies and decisions outside feature policies.

Scan API Python sources and stubs outside api/tests. Only the three explicit
feature-policy modules below may add DeploymentEdition imports, qualified enum
accesses, comparisons or match cases in production code. Reading the edition
for logging or serialization remains allowed.

Compare complete source versions, counting identical normalized occurrences
per module. Existing code and Git-detected file renames retain their baseline;
copies, changed decisions and moves out of exempt modules do not. Import
formatting and alias renames do not introduce a new dependency.

ast-grep locates candidate syntax. Python AST filtering keeps function-local
imports in their own scopes and tracks direct assignment aliases outside
function and lambda bodies. It does not resolve other forms of shadowing,
dynamic imports or reflection.

Run from the repository root with Git and ast-grep available. --staged checks
the index against HEAD; --base-rev checks committed HEAD against that revision.
Without either, inspect working and untracked files against the main merge
base. For a local rename, use git mv or stage both paths after mv so Git can
detect the rename. An untracked destination is checked as a new file.
Exit 0 on success, 1 for violations, or 2 when the check cannot run.
"""

from __future__ import annotations

import argparse
import ast
import copy
import sys
from collections import Counter, deque
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import override

from ast_grep_guard import Violation, git_output, is_python_source_path, print_violations, rule_path, run_ast_grep

_FEATURE_POLICY_MODULES = frozenset(
    {
        "api/services/feature_service.py",
        "api/services/system_feature_service.py",
        "api/services/knowledge_fs/feature_service.py",
    }
)
_ENUM_MODULES = frozenset({"enums", "api.enums"})
_FIX_GUIDANCE = (
    " Reuse or add a named capability in api/services/feature_service.py,"
    " or use api/services/system_feature_service.py for deployment-wide system policies."
)
_DEPENDENCY_MESSAGE = (
    "no-new-deployment-edition: do not import DeploymentEdition outside feature policy modules." + _FIX_GUIDANCE
)
_DECISION_MESSAGE = "no-new-deployment-edition: do not branch directly on deployment edition." + _FIX_GUIDANCE


@dataclass(frozen=True)
class _Occurrence:
    line_number: int
    key: str
    message: str


def _reference_name(node: ast.AST, bindings: dict[str, str]) -> str:
    """Precondition: bindings contains qualified names. Postcondition: resolve names and attributes, or return empty."""
    if isinstance(node, ast.Name):
        reference = bindings.get(node.id, node.id)
    elif isinstance(node, ast.Attribute) and (parent := _reference_name(node.value, bindings)):
        reference = f"{parent}.{node.attr}"
    else:
        return ""
    return (
        reference.removeprefix("api.") if reference == "api.enums" or reference.startswith("api.enums.") else reference
    )


def _is_edition_reference(node: ast.AST, bindings: dict[str, str]) -> bool:
    """Precondition: node is parsed Python. Postcondition: identify the enum, its members or raw edition setting."""
    reference = _reference_name(node, bindings)
    return (
        (isinstance(node, ast.Attribute) and node.attr == "DEPLOYMENT_EDITION")
        or reference == "enums.DeploymentEdition"
        or reference.startswith("enums.DeploymentEdition.")
        or reference.endswith(".DEPLOYMENT_EDITION")
    )


def _contains_edition(node: ast.AST, bindings: dict[str, str]) -> bool:
    """Precondition: node is parsed Python. Postcondition: report whether its syntax references deployment edition."""
    return any(_is_edition_reference(child, bindings) for child in ast.walk(node))


def _scope_nodes(roots: Iterable[ast.AST]) -> Iterator[ast.AST]:
    """Precondition: roots are parsed nodes. Postcondition: walk up to function and lambda bodies."""
    pending = deque(roots)
    while pending:
        node = pending.popleft()
        yield node
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # Defaults and decorators are evaluated in the enclosing scope.
            pending.extend(child for child in ast.iter_child_nodes(node) if not isinstance(child, ast.stmt))
        elif isinstance(node, ast.Lambda):
            pending.append(node.args)
        else:
            pending.extend(ast.iter_child_nodes(node))


def _import_bindings(nodes: Iterable[ast.AST]) -> dict[str, str]:
    """Precondition: nodes do not cross function boundaries. Postcondition: map imports to qualified names."""
    bindings: dict[str, str] = {}
    for node in nodes:
        if isinstance(node, ast.Import):
            for alias in node.names:
                bindings[alias.asname or alias.name.split(".")[0]] = (
                    alias.name if alias.asname else alias.name.split(".")[0]
                )
        elif isinstance(node, ast.ImportFrom) and node.level == 0:
            module = "enums" if node.module in _ENUM_MODULES else node.module
            for alias in node.names:
                if alias.name == "*" and module == "enums":
                    bindings["DeploymentEdition"] = "enums.DeploymentEdition"
                elif alias.name != "*":
                    bindings[alias.asname or alias.name] = f"{module}.{alias.name}"
    return bindings


def _module_bindings(nodes: list[ast.AST]) -> dict[str, str]:
    """Precondition: nodes exclude function and lambda bodies. Postcondition: map imports and direct edition aliases."""
    bindings = _import_bindings(nodes)
    for node in nodes:
        if (
            isinstance(node, ast.Assign)
            and _is_edition_reference(node.value, bindings)
            and (reference := _reference_name(node.value, bindings))
        ):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    bindings[target.id] = reference
        elif isinstance(node, (ast.AnnAssign, ast.NamedExpr)) and node.value is not None:
            if (
                isinstance(node.target, ast.Name)
                and _is_edition_reference(node.value, bindings)
                and (reference := _reference_name(node.value, bindings))
            ):
                bindings[node.target.id] = reference
    return bindings


def _nodes_with_bindings(nodes: list[ast.AST], bindings: dict[str, str]) -> Iterator[tuple[ast.AST, dict[str, str]]]:
    """Precondition: bindings apply to nodes. Postcondition: yield nodes with imports local to each function."""
    for node in nodes:
        yield node, bindings
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            body = list(_scope_nodes(node.body))
            yield from _nodes_with_bindings(body, bindings | _import_bindings(body))
        elif isinstance(node, ast.Lambda):
            yield from ((child, bindings) for child in ast.walk(node.body))


class _NormalizeBindings(ast.NodeTransformer):
    def __init__(self, bindings: dict[str, str]) -> None:
        """Precondition: bindings maps identifiers to qualified names. Postcondition: retain them for normalization."""
        self._bindings = bindings

    @override
    def visit_Name(self, node: ast.Name) -> ast.AST:
        """Precondition: node is an identifier. Postcondition: replace import and assignment aliases in fingerprints."""
        reference = _reference_name(node, self._bindings)
        return ast.parse(reference, mode="eval").body if reference else node


def _fingerprint(node: ast.AST, bindings: dict[str, str]) -> str:
    """Precondition: node is parsed syntax. Postcondition: normalize formatting and aliases without mutating node."""
    return ast.dump(_NormalizeBindings(bindings).visit(copy.deepcopy(node)))


def _occurrences(source: str, path: str) -> list[_Occurrence]:
    """Precondition: source is Python. Postcondition: return edition occurrences; parse and scan failures propagate."""
    tree = ast.parse(source, filename=path)
    module_nodes = list(_scope_nodes(tree.body))
    candidate_lines = {
        match.line_number for match in run_ast_grep(source, rule=rule_path("no_new_deployment_edition.yml"))
    }
    occurrences = []
    # Use nodes from the complete file: a multiline comparison need not be valid Python without its outer parentheses.
    for statement, bindings in _nodes_with_bindings(module_nodes, _module_bindings(module_nodes)):
        if (
            isinstance(statement, ast.ImportFrom)
            and statement.lineno in candidate_lines
            and statement.level == 0
            and statement.module in _ENUM_MODULES
        ):
            for alias in statement.names:
                if alias.name in {"DeploymentEdition", "*"}:
                    occurrences.append(_Occurrence(alias.lineno, f"import:{alias.name}", _DEPENDENCY_MESSAGE))
        elif (
            isinstance(statement, ast.Compare)
            and statement.lineno in candidate_lines
            and _contains_edition(statement, bindings)
        ):
            occurrences.append(_Occurrence(statement.lineno, _fingerprint(statement, bindings), _DECISION_MESSAGE))
        elif (
            isinstance(statement, ast.Attribute)
            and statement.lineno in candidate_lines
            and statement.attr == "DeploymentEdition"
            and _is_edition_reference(statement, bindings)
        ):
            occurrences.append(_Occurrence(statement.lineno, _fingerprint(statement, bindings), _DEPENDENCY_MESSAGE))
        elif isinstance(statement, ast.Match) and statement.lineno in candidate_lines:
            for case in statement.cases:
                if _contains_edition(statement.subject, bindings) or _contains_edition(case.pattern, bindings):
                    # Branch bodies have their own candidates; editing them must not consume the match baseline.
                    key = f"match:{_fingerprint(statement.subject, bindings)}:{_fingerprint(case.pattern, bindings)}"
                    occurrences.append(_Occurrence(case.pattern.lineno, key, _DECISION_MESSAGE))
    return occurrences


def _is_guarded_source(path: str) -> bool:
    """Precondition: path comes from Git's API path listing. Postcondition: identify guarded Python sources."""
    return is_python_source_path(path) and not path.startswith("api/tests/") and path not in _FEATURE_POLICY_MODULES


def _file_versions(args: argparse.Namespace) -> dict[str, tuple[str, str]]:
    """Precondition: cwd is a Git checkout. Postcondition: read sources and baselines from guarded paths only."""
    local = not args.staged and not args.base_rev
    baseline = "HEAD" if args.staged else args.base_rev
    if local:
        baseline = next(
            (
                merge_base
                for revision in ("upstream/main", "origin/main", "main")
                if (merge_base := git_output("merge-base", "HEAD", revision, allow_missing=True).strip())
            ),
            "HEAD",
        )
    revisions = [baseline] if local else (["--cached"] if args.staged else [f"{baseline}..HEAD"])
    status_text = git_output(
        "diff", "--name-status", "-z", "--find-renames", "--diff-filter=AMRD", "--no-ext-diff", *revisions, "--", "api"
    )
    fields = iter(status_text.rstrip("\0").split("\0") if status_text else [])
    versions = {}
    for status in fields:
        old_path = next(fields)
        path = next(fields) if status.startswith("R") else old_path
        if status != "D" and _is_guarded_source(path):
            old_source = (
                ""
                if status == "A" or not _is_guarded_source(old_path)
                else git_output("show", f"{baseline}:{old_path}")
            )
            if local:
                new_source = Path(path).read_text(encoding="utf-8")
            else:
                revision = "" if args.staged else "HEAD"
                new_source = git_output("show", f"{revision}:{path}")
            versions[path] = (old_source, new_source)
    if local:
        for path in git_output("ls-files", "--others", "--exclude-standard", "-z", "api").rstrip("\0").split("\0"):
            if _is_guarded_source(path):
                versions[path] = ("", Path(path).read_text(encoding="utf-8"))
    return versions


def _find_violations(versions: dict[str, tuple[str, str]]) -> list[Violation]:
    """Precondition: versions contains non-exempt API sources. Postcondition: report only new per-module occurrences."""
    violations = []
    for path, (old_source, new_source) in versions.items():
        existing = Counter(occurrence.key for occurrence in _occurrences(old_source, path))
        for occurrence in _occurrences(new_source, path):
            if existing[occurrence.key]:
                existing[occurrence.key] -= 1
            else:
                violations.append(Violation(path, occurrence.line_number, occurrence.message))
    return sorted(violations, key=lambda violation: (violation.path, violation.line_number))


def main() -> int:
    """Precondition: Git and ast-grep are available. Postcondition: return 0/1/2 without modifying checkout contents."""
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--base-rev", help="Compare this revision with committed HEAD.")
    source.add_argument("--staged", action="store_true", help="Compare staged changes with HEAD.")
    args = parser.parse_args()
    try:
        violations = _find_violations(_file_versions(args))
    except (OSError, RuntimeError, SyntaxError) as error:
        sys.stderr.write(f"{error}\n")
        return 2
    print_violations(violations)
    return int(bool(violations))


if __name__ == "__main__":
    raise SystemExit(main())
