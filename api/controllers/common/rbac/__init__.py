from flask import request

from core.rbac import RBACPermission, RBACResourceScope

from .checks import RBAC_CHECKS_ATTR, RBACCheck, enforce_rbac_checks
from .locators import (
    AgentBehindApp,
    AgentId,
    DatasetByDocument,
    DatasetByPipeline,
    DatasetId,
    PlainApp,
    ResourceIdentity,
    ResourceLocator,
    Workspace,
)

__all__ = [
    "RBAC_CHECKS_ATTR",
    "AgentBehindApp",
    "AgentId",
    "DatasetByDocument",
    "DatasetByPipeline",
    "DatasetId",
    "PlainApp",
    "RBACCheck",
    "RBACPermission",
    "RBACResourceScope",
    "ResourceIdentity",
    "ResourceLocator",
    "Workspace",
    "enforce_rbac_checks",
    "rbac_language",
]


def rbac_language() -> str | None:
    """Read and normalize the optional RBAC label language from the query string."""
    value = (request.args.get("language") or "").strip().lower()
    return value if value in {"en", "ja", "zh"} else None
