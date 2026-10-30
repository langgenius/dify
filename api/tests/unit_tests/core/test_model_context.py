from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor

import pytest

from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.model_context import get_credit_usage_metadata, use_credit_usage_metadata, with_credit_usage_created_by
from extensions.otel import propagate_context


def test_credit_usage_metadata_is_scoped_and_propagated_to_worker_threads() -> None:
    with use_credit_usage_metadata({"app_type": CreditUsageAppType.WORKFLOW}):
        assert get_credit_usage_metadata() == {"app_type": CreditUsageAppType.WORKFLOW}

        with ThreadPoolExecutor(max_workers=1) as executor:
            read_context = propagate_context(get_credit_usage_metadata)
            assert executor.submit(read_context).result() == {"app_type": CreditUsageAppType.WORKFLOW}

    assert get_credit_usage_metadata() is None


def test_nested_credit_usage_metadata_keeps_app_type_and_direct_feature() -> None:
    with use_credit_usage_metadata({"app_type": CreditUsageAppType.WORKFLOW}):
        with use_credit_usage_metadata({"created_by": CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL}):
            assert get_credit_usage_metadata() == {
                "app_type": CreditUsageAppType.WORKFLOW,
                "created_by": CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL,
            }


def test_credit_usage_created_by_decorator_sets_feature() -> None:
    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL)
    def read_context() -> object:
        return get_credit_usage_metadata()

    assert read_context() == {"created_by": CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL}


def test_credit_usage_created_by_decorator_holds_context_while_generator_runs() -> None:
    seen: list[object] = []

    @with_credit_usage_created_by(CreditUsageCreatedBy.AUDIO)
    def generate() -> Generator[object]:
        seen.append(get_credit_usage_metadata())
        yield "first"
        seen.append(get_credit_usage_metadata())
        yield "second"

    generator = generate()
    # creating a generator does not run the body; the decorator's context
    # must be active when it does
    assert seen == []

    assert list(generator) == ["first", "second"]
    assert seen == [
        {"created_by": CreditUsageCreatedBy.AUDIO},
        {"created_by": CreditUsageCreatedBy.AUDIO},
    ]
    assert get_credit_usage_metadata() is None


def test_credit_usage_created_by_decorator_restores_caller_context_between_yields() -> None:
    seen: list[object] = []

    @with_credit_usage_created_by(CreditUsageCreatedBy.AUDIO)
    def generate() -> Generator[object]:
        seen.append(get_credit_usage_metadata())
        sent = yield "first"
        seen.append(get_credit_usage_metadata())
        seen.append(sent)
        yield "second"

    generator = generate()
    assert get_credit_usage_metadata() is None

    assert next(generator) == "first"
    # a suspended generator must not leave its metadata in the caller's context
    assert get_credit_usage_metadata() is None

    assert generator.send("payload") == "second"
    assert get_credit_usage_metadata() is None

    assert seen == [
        {"created_by": CreditUsageCreatedBy.AUDIO},
        {"created_by": CreditUsageCreatedBy.AUDIO},
        "payload",
    ]
    with pytest.raises(StopIteration):
        next(generator)
    assert get_credit_usage_metadata() is None


def test_credit_usage_created_by_decorator_restores_context_after_early_close() -> None:
    seen_on_close: list[object] = []

    @with_credit_usage_created_by(CreditUsageCreatedBy.AUDIO)
    def generate() -> Generator[object]:
        try:
            yield "first"
            yield "second"
        finally:
            seen_on_close.append(get_credit_usage_metadata())

    generator = generate()
    assert next(generator) == "first"
    assert get_credit_usage_metadata() is None

    generator.close()

    assert get_credit_usage_metadata() is None
    assert seen_on_close == [{"created_by": CreditUsageCreatedBy.AUDIO}]


def test_credit_usage_created_by_decorator_restores_context_after_throw() -> None:
    seen: list[object] = []

    @with_credit_usage_created_by(CreditUsageCreatedBy.AUDIO)
    def generate() -> Generator[object]:
        try:
            yield "first"
        except ValueError as exc:
            seen.append((get_credit_usage_metadata(), str(exc)))
            yield "handled"

    generator = generate()
    assert next(generator) == "first"
    assert get_credit_usage_metadata() is None

    assert generator.throw(ValueError("boom")) == "handled"
    assert get_credit_usage_metadata() is None
    assert seen == [({"created_by": CreditUsageCreatedBy.AUDIO}, "boom")]

    generator.close()
    assert get_credit_usage_metadata() is None


def test_credit_usage_created_by_decorator_preserves_generator_return_value() -> None:
    @with_credit_usage_created_by(CreditUsageCreatedBy.AUDIO)
    def generate() -> Generator[object]:
        yield "only"
        return "return-value"

    generator = generate()
    assert next(generator) == "only"
    with pytest.raises(StopIteration) as exc_info:
        next(generator)
    assert exc_info.value.value == "return-value"
    assert get_credit_usage_metadata() is None
