"""
Repository factory for creating repository instances.

This module provides a simple factory interface for creating repository instances.
It does not contain any implementation details or dependencies on specific repositories.
"""

from collections.abc import Callable, Mapping
from typing import Any, Optional

# Type for factory functions - takes a dict of parameters and returns any repository type
RepositoryFactoryFunc = Callable[[Mapping[str, Any]], Any]


class RepositoryFactory:
    """
    Factory class for creating repository instances.

    This factory delegates the actual repository creation to implementation-specific
    factory functions that are registered with the factory at runtime.
    """

    # Dictionary to store factory functions
    _factory_functions: dict[str, RepositoryFactoryFunc] = {}

    @classmethod
    def register_factory(cls, repository_type: str, factory_func: RepositoryFactoryFunc) -> None:
        """
        Register a factory function for a specific repository type.

        Args:
            repository_type: The type of repository (e.g., 'workflow_node_execution')
            factory_func: A function that takes parameters and returns a repository instance
        """
        cls._factory_functions[repository_type] = factory_func

    @classmethod
    def create_repository(cls, repository_type: str, params: Optional[Mapping[str, Any]] = None) -> Any:
        """
        Create a new repository instance with the provided parameters.

        Args:
            repository_type: The type of repository to create
            params: A dictionary of parameters to pass to the factory function

        Returns:
            A new instance of the requested repository

        Raises:
            ValueError: If no factory function is registered for the repository type
        """
        if repository_type not in cls._factory_functions:
            raise ValueError(f"No factory function registered for repository type '{repository_type}'")

        # Use empty dict if params is None
        params = params or {}

        return cls._factory_functions[repository_type](params)
