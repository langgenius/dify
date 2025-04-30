"""
Extension for initializing repositories.

This extension registers repository implementations with the RepositoryFactory.
"""

from core.repositories.repository_registry import register_repositories
from dify_app import DifyApp


def init_app(_app: DifyApp) -> None:
    """
    Initialize repository implementations.

    Args:
        _app: The Flask application instance (unused)
    """
    register_repositories()
