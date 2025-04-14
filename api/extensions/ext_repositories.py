"""
Extension for initializing repositories.

This extension registers repository implementations with the RepositoryFactory.
"""

from dify_app import DifyApp
from repositories.repository_registry import register_repositories


def init_app(_app: DifyApp) -> None:
    """
    Initialize repository implementations.

    Args:
        _app: The Flask application instance (unused)
    """
    register_repositories()
