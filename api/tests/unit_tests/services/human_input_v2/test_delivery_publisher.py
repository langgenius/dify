from datetime import datetime

from core.human_input_v2.shared import DeliveryAttemptId
from services.human_input_v2.delivery_publisher import HumanInputV2DueAttemptPublisher

_NOW = datetime(2026, 7, 31, 8)


class Repository:
    def list_due_ids(self, *, now, limit):
        assert now == _NOW
        assert limit == 2
        return (
            DeliveryAttemptId("attempt-1"),
            DeliveryAttemptId("attempt-2"),
        )


def test_publisher_is_bounded_and_leaves_failed_publication_durable() -> None:
    published = []

    def enqueue(attempt_id):
        if attempt_id == DeliveryAttemptId("attempt-1"):
            raise RuntimeError("broker unavailable")
        published.append(attempt_id)

    result = HumanInputV2DueAttemptPublisher(
        Repository(),
        enqueue,
        clock=lambda: _NOW,
        batch_size=2,
    ).publish_due()

    assert result.due_count == 2
    assert result.published_count == 1
    assert published == [DeliveryAttemptId("attempt-2")]
