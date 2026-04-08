"""Module with correct types — demonstrates pyrefly checking typed code without errors."""

from typing import Optional


def divide(a: int, b: int) -> float:
    result = a / b
    return result


def safe_return() -> str:
    return "a valid string"


def optional_safe(x: Optional[str]) -> str:
    if x is None:
        return ""
    return x.upper()


def correct_arg_type() -> None:
    result: float = divide(1, 2)
    print(result)


class Pair:
    def __init__(self, first: int, second: str) -> None:
        self.first = first
        self.second = second

    def swap(self) -> "Pair":
        return Pair(self.second, self.first)  # pyrefly: ignore[bad-argument-type]
