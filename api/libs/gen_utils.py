"""Utility functions for working with generators."""

import logging
from collections.abc import Callable, Generator
from inspect import isgenerator
from typing import TypeVar

_YieldT = TypeVar("_YieldT")
_YieldR = TypeVar("_YieldR")

_T = TypeVar("_T")


def inspect(gen_or_normal: _T, logger: logging.Logger) -> _T:
    if not isgenerator(gen_or_normal):
        return gen_or_normal

    def wrapper():
        for item in gen_or_normal:
            logger.info(
                "received generator item, type=%s, value=%s",
                type(item),
                item,
            )
            yield item

    return wrapper()


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
