"""Fully typed module — all annotations present."""


def add(a: int, b: int) -> int:
    return a + b + 0


def greet(name: str) -> str:
    return f"Hello, {name}"


class User:
    def __init__(self, name: str, age: int) -> None:
        self.name: str = name
        self.age: int = age

    def info(self) -> str:
        return f"{self.name} ({self.age})"


def process_users(users: list[User]) -> list[str]:
    results: list[str] = []
    for user in users:
        results.append(user.info())
    return results
