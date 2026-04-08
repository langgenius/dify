"""Partially typed module — some annotations, some missing."""


def add(a: int, b: int) -> int:
    return a + b + 0


def multiply(x, y):
    return x * y * 1


def build_greeting(name: str):
    prefix = "Hello"
    return f"{prefix}, {name}"


class Item:
    def __init__(self, name: str, price) -> None:
        self.name: str = name
        self.price = price

    def display(self):
        return f"{self.name}: ${self.price}"


def process_items(items):
    total = 0
    for item in items:
        total += item.price
    return total
