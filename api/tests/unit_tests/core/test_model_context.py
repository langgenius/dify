from concurrent.futures import ThreadPoolExecutor

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
    with (
        use_credit_usage_metadata({"app_type": CreditUsageAppType.WORKFLOW}),
        use_credit_usage_metadata({"created_by": CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL}),
    ):
        assert get_credit_usage_metadata() == {
            "app_type": CreditUsageAppType.WORKFLOW,
            "created_by": CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL,
        }


def test_credit_usage_created_by_decorator_sets_feature() -> None:
    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL)
    def read_context() -> object:
        return get_credit_usage_metadata()

    assert read_context() == {"created_by": CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL}
