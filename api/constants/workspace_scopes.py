# Workspace API Key Scopes
WORKSPACE_API_SCOPES = {
    # Workspace management
    "workspace:read": "Read workspace information",
    "workspace:write": "Modify workspace settings",
    # Apps management
    "apps:read": "Read applications",
    "apps:write": "Create and modify applications",
    "apps:admin": "Full applications administration",
    # Members management
    "members:read": "Read workspace members",
    "members:write": "Invite and modify members",
    "members:admin": "Remove members from workspace",
}

# Default scopes for new API keys
DEFAULT_API_KEY_SCOPES = []

# Scope categories for UI grouping
SCOPE_CATEGORIES = {
    "workspace": {"name": "Workspace", "scopes": ["workspace:read", "workspace:write"]},
    "apps": {"name": "Applications", "scopes": ["apps:read", "apps:write", "apps:admin"]},
    "members": {"name": "Members", "scopes": ["members:read", "members:write", "members:admin"]},
}


def get_valid_scopes():
    """Get all valid scopes"""
    return list(WORKSPACE_API_SCOPES.keys())


def validate_scopes(scopes):
    """Validate a list of scopes"""
    valid_scopes = get_valid_scopes()
    invalid_scopes = [scope for scope in scopes if scope not in valid_scopes]
    return len(invalid_scopes) == 0, invalid_scopes


def get_scope_description(scope):
    """Get description for a scope"""
    return WORKSPACE_API_SCOPES.get(scope, "")
