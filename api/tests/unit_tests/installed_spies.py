"""Inspect actual spies installed on real objects, including autospec wrappers."""

from typing import Protocol, runtime_checkable
from unittest.mock import Mock


@runtime_checkable
class _AutospeccedMethod(Protocol):
    # unittest.mock.create_autospec exposes the underlying spy on its function wrapper.
    mock: Mock


def installed_mock(method: object) -> Mock:
    """Return the installed spy without treating a real bound method as a mock."""
    if isinstance(method, Mock):
        return method
    assert isinstance(method, _AutospeccedMethod)
    return method.mock
