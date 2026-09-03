from collections.abc import Callable

from controllers.common.rbac import RBACCheck


def rbac_checks(view: Callable[..., object]) -> tuple[RBACCheck, ...]:
    current = view
    while "rbac_checks" not in current.__dict__:
        wrapped = current.__dict__.get("__wrapped__")
        if wrapped is None:
            raise AssertionError(f"no decorator layer of {view!r} carries an rbac_checks bundle")
        current = wrapped
    return current.rbac_checks


def all_rbac_checks(view: Callable[..., object]) -> list[RBACCheck]:
    found: list[RBACCheck] = []
    seen_bundle_ids: set[int] = set()
    current: Callable[..., object] | None = view
    while current is not None:
        bundle = current.__dict__.get("rbac_checks")
        if bundle is not None and id(bundle) not in seen_bundle_ids:
            seen_bundle_ids.add(id(bundle))
            found.extend(bundle)
        current = current.__dict__.get("__wrapped__")
    return found
