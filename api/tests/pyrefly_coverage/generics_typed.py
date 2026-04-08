"""Module with generics and complex type annotations."""

from typing import TypeVar, Generic, Callable

T = TypeVar("T")
U = TypeVar("U")


class Stack(Generic[T]):
    def __init__(self) -> None:
        self._items: list[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)

    def pop(self) -> T:
        return self._items.pop()

    def peek(self) -> T:
        return self._items[-1]

    def is_empty(self) -> bool:
        return len(self._items) == 0


def map_list(func: Callable[[T], U], items: list[T]) -> list[U]:
    return [func(item) for item in items]


def first_or_default(items: list[T], default: T) -> T:
    if items:
        return items[0]
    return default


def pipeline(value: T, *transforms: Callable[[T], T]) -> T:
    result: T = value
    for fn in transforms:
        result = fn(result)
    return result
