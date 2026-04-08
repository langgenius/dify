"""Module with type errors to test error reporting."""

from typing import Optional


def divide(a: int, b: int) -> float:
    return a / b


def bad_return() -> int:
    return "not an int"  # type error: str vs int


def optional_misuse(x: Optional[str]) -> str:
    return x.upper()  # type error: x could be None


def wrong_arg_type() -> None:
    result: int = divide(1, 2)  # type error: float assigned to int
    print(result)


class Pair:
    def __init__(self, first: int, second: str) -> None:
        self.first = first
        self.second = second

    def swap(self) -> "Pair":
        return Pair(self.second, self.first)  # type error: swapped types
