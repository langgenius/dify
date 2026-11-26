import pytest
from pydantic import ValidationError

from configs.middleware.vdb.iris_config import IrisVectorConfig


@pytest.mark.parametrize(
    ("minimum", "maximum", "expected"),
    [(None, None, (1, 3)), ("2", None, (2, 3)), (None, "10", (1, 10)), ("2", "10", (2, 10)), ("10", "10", (10, 10))],
)
def test_pool_limits_are_compared_after_environment_coercion(
    monkeypatch: pytest.MonkeyPatch, minimum: str | None, maximum: str | None, expected: tuple[int, int]
) -> None:
    """Environment strings and omitted defaults produce validated numeric pool bounds."""
    for name, value in (("IRIS_MIN_CONNECTION", minimum), ("IRIS_MAX_CONNECTION", maximum)):
        monkeypatch.delenv(name, raising=False)
        if value is not None:
            monkeypatch.setenv(name, value)

    config = IrisVectorConfig()

    actual = (config.IRIS_MIN_CONNECTION, config.IRIS_MAX_CONNECTION)
    assert actual == expected


def test_environment_pool_minimum_cannot_exceed_maximum(monkeypatch: pytest.MonkeyPatch) -> None:
    """Numerically inverted string settings are rejected even when lexical order differs."""
    monkeypatch.setenv("IRIS_MIN_CONNECTION", "20")
    monkeypatch.setenv("IRIS_MAX_CONNECTION", "3")

    with pytest.raises(ValidationError, match="IRIS_MIN_CONNECTION must be less than or equal"):
        IrisVectorConfig()


@pytest.mark.parametrize("minimum", ["0", "-1", "invalid"])
def test_invalid_pool_bound_retains_pydantic_validation_errors(monkeypatch: pytest.MonkeyPatch, minimum: str) -> None:
    """Invalid external bounds fail field validation instead of raising comparison TypeError."""
    monkeypatch.setenv("IRIS_MIN_CONNECTION", minimum)
    monkeypatch.delenv("IRIS_MAX_CONNECTION", raising=False)

    with pytest.raises(ValidationError, match="IRIS_MIN_CONNECTION"):
        IrisVectorConfig()
