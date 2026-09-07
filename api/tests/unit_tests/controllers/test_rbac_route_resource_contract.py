"""Guard against resource-scoped RBAC gates mounted on routes their locator can't read.

Every RBAC gate is declared as one or more explicit ``RBACCheck(scene, Locator(...))``
bundles, via ``rbac_permission_required(RBACCheck(...), ...)`` or
``console_account_admission(rbac_checks=[RBACCheck(...), ...])``. Each locator reads a
path parameter — its explicit ``param`` argument, or its class default (``PlainApp`` reads
``app_id``, ``DatasetId`` reads ``dataset_id``, etc.; ``Workspace`` reads none). A route
whose URL doesn't carry that parameter can never resolve the check.

This check runs against the registered namespaces rather than the source text: both
decorators record their checks on the view function under ``RBAC_CHECKS_ATTR``, and reading
them back at runtime also covers resources built by a factory (the RBAC access-permission
endpoints in ``controllers/console/workspace/rbac.py``), which no AST scan can see.
"""

from __future__ import annotations

from collections.abc import Iterator

import controllers.console  # noqa: F401  -- importing the package registers every console route
import controllers.openapi  # noqa: F401  -- same for the user-scoped OpenAPI routes
from controllers.common.rbac import RBAC_CHECKS_ATTR, RBACCheck
from controllers.console import console_ns
from controllers.openapi import openapi_ns

NAMESPACES = (console_ns, openapi_ns)

HTTP_METHODS = ("delete", "get", "head", "options", "patch", "post", "put")

# Known violations tracked separately: DatasetDocumentSegmentBatchImportApi binds one class
# to both the dataset-scoped import route and the job-scoped status route, so every method
# on it is reachable at a path carrying only a job id. Its permission points are genuinely
# per-dataset, so it needs the route split rather than a Workspace() locator. Remove these
# entries with that fix.
KNOWN_VIOLATIONS = {
    ("DatasetDocumentSegmentBatchImportApi", "post"),
    ("DatasetDocumentSegmentBatchImportApi", "get"),
}

# The generated access-permission endpoints, spelled out here so this guard fails loudly if
# the factory stops registering them (or renames a URL) rather than silently checking less.
RBAC_ACCESS_RESOURCE_PARTS = (("apps", "app_id"), ("datasets", "dataset_id"), ("agents", "agent_id"))


def _rbac_access_urls() -> set[str]:
    urls: set[str] = set()
    for segment, id_param in RBAC_ACCESS_RESOURCE_PARTS:
        resource = f"/workspaces/current/rbac/{segment}/<uuid:{id_param}>"
        workspace = f"/workspaces/current/rbac/workspace/{segment}"
        urls.update(
            {
                f"{resource}/access-policy",
                f"{resource}/whitelist",
                f"{resource}/whitelist_config",
                f"{resource}/user-access-policies",
                f"{resource}/users/<uuid:target_account_id>/access-policies",
                f"{resource}/access-policies/<uuid:policy_id>/role-bindings",
                f"{resource}/access-policies/<string:policy_id>/member-bindings",
                f"{workspace}/access-policy",
                f"{workspace}/access-policies/<uuid:policy_id>/role-bindings",
                f"{workspace}/access-policies/<uuid:policy_id>/bindings",
                f"{workspace}/access-policies/<uuid:policy_id>/member-bindings",
            }
        )
    return urls


def _class_attribute(resource: type, name: str) -> object | None:
    """Look up ``name`` on ``resource`` through the MRO without ``getattr``."""
    for klass in resource.__mro__:
        attributes = vars(klass)
        if name in attributes:
            return attributes[name]
    return None


def _declared_checks(view: object) -> list[RBACCheck]:
    """Collect the RBAC checks a decorator recorded anywhere in this view's wrapper chain.

    ``functools.wraps`` copies the recorded tuple onto every outer wrapper, so the same
    bundle shows up at several levels; identity tells the copies apart from a second gate.
    """
    checks: list[RBACCheck] = []
    seen: set[int] = set()
    current = view
    while current is not None:
        attributes = vars(current)
        recorded = attributes.get(RBAC_CHECKS_ATTR)
        if recorded and id(recorded) not in seen:
            seen.add(id(recorded))
            checks.extend(recorded)
        current = attributes.get("__wrapped__")
    return checks


def _path_args(route: str) -> set[str]:
    return {segment.split(">")[0].split(":")[-1] for segment in route.split("<")[1:]}


def _registered_methods() -> Iterator[tuple[type, str, object, tuple[str, ...]]]:
    """Yield ``(resource class, method name, view function, urls)`` for every routed method."""
    for namespace in NAMESPACES:
        for route in namespace.resources:
            for method_name in HTTP_METHODS:
                view = _class_attribute(route.resource, method_name)
                if view is None:
                    continue
                yield route.resource, method_name, view, tuple(route.urls)


def test_resource_scoped_rbac_gates_have_a_resource_id_in_the_route() -> None:
    violations = []

    for resource, method_name, view, urls in _registered_methods():
        if (resource.__name__, method_name) in KNOWN_VIOLATIONS:
            continue

        for check in _declared_checks(view):
            # Only ``_ParamLocator`` subclasses store a path parameter; ``Workspace`` reads none.
            required_param = vars(check.locator).get("param")
            if not isinstance(required_param, str):
                continue

            unscoped = [url for url in urls if required_param not in _path_args(url)]
            if unscoped:
                violations.append(
                    f"{resource.__name__}.{method_name} "
                    f"locator={type(check.locator).__name__}({required_param!r}) "
                    f"scene={check.scene} routes={unscoped}"
                )

    assert not violations, "RBACCheck locator on a route that doesn't carry its required path parameter:\n" + "\n".join(
        violations
    )


def test_guard_reaches_the_generated_rbac_access_endpoints() -> None:
    """The factory-built endpoints are the reason this guard is runtime-based; prove it sees them."""
    scanned_urls = {url for _, _, _, urls in _registered_methods() for url in urls}

    missing = sorted(_rbac_access_urls() - scanned_urls)

    assert not missing, "generated RBAC access routes are not reachable by this guard:\n" + "\n".join(missing)
