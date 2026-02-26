from typing import TypedDict


class DailyRunsStats(TypedDict):
    date: str
    runs: int


class DailyTerminalsStats(TypedDict):
    date: str
    terminal_count: int


class DailyTokenCostStats(TypedDict):
    date: str
    token_count: int


class AverageInteractionStats(TypedDict):
    date: str
    interactions: float
