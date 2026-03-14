from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .datasource_node import DatasourceNode

__all__ = ["DatasourceNode"]


def __getattr__(name: str) -> Any:
    if name == "DatasourceNode":
        from .datasource_node import DatasourceNode

        return DatasourceNode
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
