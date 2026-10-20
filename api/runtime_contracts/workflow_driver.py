"""Opaque workflow callback carried through lower-level runtime adapters.

These adapters only store and forward the callback; they never invoke it.
The application runner owns the precise invocation signature, preparation,
repository validation, and execution orchestration contract.
"""

from collections.abc import Callable

type WorkflowRunDriver = Callable[..., None]
