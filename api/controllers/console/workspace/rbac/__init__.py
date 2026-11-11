"""Register workspace RBAC endpoints by use case."""

from controllers.console.workspace.rbac import members, policies, resources, roles

__all__ = ["members", "policies", "resources", "roles"]
