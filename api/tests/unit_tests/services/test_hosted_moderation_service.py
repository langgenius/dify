from collections.abc import Mapping, Sequence

import pytest

from machinery.context import AppRequestContext
from services.hosted_moderation_service import BatchedHostedModerationService, HostedModerationUnavailableError
from services.moderation_service import ModerationRejectedError, ModerationRule

_CONTEXT = AppRequestContext(tenant_id="tenant-1", app_id="app-1")
_RULE = ModerationRule(
    type="openai_moderation",
    config={
        "inputs_config": {"enabled": True, "preset_response": "Input rejected"},
        "outputs_config": {"enabled": True, "preset_response": "Output rejected"},
    },
)


class _BatchClient:
    """Record batches at the provider boundary and classify each text independently."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, ...]] = []
        self.incomplete = False

    def moderate(self, texts: Sequence[str]) -> tuple[bool, ...]:
        self.calls.append(tuple(texts))
        return tuple(text == "blocked" for text in (texts[:-1] if self.incomplete else texts))


class _VerdictCache:
    """Implement the cache port in memory without simulating the service's hit/miss decisions."""

    def __init__(self) -> None:
        self.entries: dict[tuple[str, str], bool] = {}

    def lookup(self, tenant_id: str, texts: Sequence[str]) -> dict[str, bool]:
        return {text: self.entries[tenant_id, text] for text in texts if (tenant_id, text) in self.entries}

    def store(self, tenant_id: str, verdicts: Mapping[str, bool]) -> None:
        self.entries.update({(tenant_id, text): flagged for text, flagged in verdicts.items()})


def test_checks_only_distinct_misses_across_turns_and_phases() -> None:
    client = _BatchClient()
    service = BatchedHostedModerationService(
        client=client, cache=_VerdictCache(), batch_max_items=32, batch_max_text_bytes=8192
    )
    service.check_segments(_CONTEXT, rule=_RULE, segments=["system", "first turn", "system", ""], phase="input")
    service.check_segments(_CONTEXT, rule=_RULE, segments=["answer"], phase="output")
    service.check_segments(
        _CONTEXT, rule=_RULE, segments=["system", "first turn", "answer", "next turn", "more"], phase="input"
    )
    assert client.calls == [("system", "first turn"), ("answer",), ("next turn", "more")]


def test_cached_rejection_uses_current_phase_and_does_not_reclassify() -> None:
    client = _BatchClient()
    service = BatchedHostedModerationService(
        client=client, cache=_VerdictCache(), batch_max_items=32, batch_max_text_bytes=8192
    )
    with pytest.raises(ModerationRejectedError, match="Output rejected"):
        service.check_segments(_CONTEXT, rule=_RULE, segments=["safe", "blocked"], phase="output")
    with pytest.raises(ModerationRejectedError, match="Input rejected"):
        service.check_segments(_CONTEXT, rule=_RULE, segments=["uncached", "blocked"], phase="input")
    service.check_segments(_CONTEXT, rule=_RULE, segments=["safe"], phase="input")
    assert client.calls == [("safe", "blocked")]


@pytest.mark.parametrize(
    ("texts", "sizes"),
    [
        ([f"segment-{index}" for index in range(65)], [32, 32, 1]),
        ([f"{index}" + "\u754c" * 1300 for index in range(3)], [2, 1]),
        (["first", "x" * 9000, "last"], [1, 1, 1]),
    ],
    ids=["item-cap", "utf8-byte-cap", "oversized-singleton"],
)
def test_batches_preserve_order_and_segment_contents(texts: list[str], sizes: list[int]) -> None:
    client = _BatchClient()
    service = BatchedHostedModerationService(client=client, cache=None, batch_max_items=32, batch_max_text_bytes=8192)
    service.check_segments(_CONTEXT, rule=_RULE, segments=texts, phase="input")
    assert [len(batch) for batch in client.calls] == sizes
    assert [text for batch in client.calls for text in batch] == texts


def test_incomplete_batch_does_not_approve_or_cache_any_returned_verdict() -> None:
    client = _BatchClient()
    cache = _VerdictCache()
    service = BatchedHostedModerationService(client=client, cache=cache, batch_max_items=32, batch_max_text_bytes=8192)
    client.incomplete = True
    with pytest.raises(HostedModerationUnavailableError, match="invalid batch verdicts"):
        service.check_segments(_CONTEXT, rule=_RULE, segments=["one", "two"], phase="input")
    assert cache.entries == {}
    client.incomplete = False
    service.check_segments(_CONTEXT, rule=_RULE, segments=["one", "two"], phase="input")
    assert client.calls == [("one", "two"), ("one", "two")]


@pytest.mark.parametrize(("max_items", "max_text_bytes"), [(0, 8192), (32, 0)])
def test_batch_limits_must_be_positive(max_items: int, max_text_bytes: int) -> None:
    with pytest.raises(ValueError, match="batch limits must be positive"):
        BatchedHostedModerationService(
            client=_BatchClient(), cache=None, batch_max_items=max_items, batch_max_text_bytes=max_text_bytes
        )


def test_missing_platform_credentials_cannot_use_a_cached_approval() -> None:
    cache = _VerdictCache()
    cache.store(_CONTEXT.tenant_id, {"cached": False})
    service = BatchedHostedModerationService(client=None, cache=cache, batch_max_items=32, batch_max_text_bytes=8192)
    with pytest.raises(HostedModerationUnavailableError, match="credentials are not configured"):
        service.check_segments(_CONTEXT, rule=_RULE, segments=["cached"], phase="input")
