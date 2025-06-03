"""Utility functions for working with generators."""

from collections.abc import Callable, Generator
from typing import TypeVar

_YieldT = TypeVar("_YieldT")
_YieldR = TypeVar("_YieldR")


def map_(
    gen: Generator[_YieldT, None, None],
    mapper: Callable[[_YieldT], _YieldR],
) -> Generator[_YieldR, None, None]:
    for item in gen:
        yield mapper(item)


def filter_(
    gen: Generator[_YieldT, None, None],
    mapper: Callable[[_YieldT], bool],
) -> Generator[_YieldT, None, None]:
    for item in gen:
        if mapper(item):
            yield item


def wrap(
    gen: Generator[_YieldT, None, None],
    funcs: list[Callable[[Generator[_YieldT, None, None]], Generator[_YieldT, None, None]]],
) -> Generator[_YieldT, None, None]:
    for f in funcs:
        gen = f(gen)
    return gen
