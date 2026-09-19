from __future__ import annotations

import queue
import threading
from abc import ABC, abstractmethod

import pytest

from libs.durable_stream import (
    CLOSED,
    CursorUnavailableError,
    DurableStreamRecord,
    DurableStreamSubscription,
    DurableStreamTopic,
    DurableStreamUnavailableError,
    TopicCursor,
)


class DurableStreamContract(ABC):
    """Backend-independent behavioral contract for durable stream adapters."""

    @abstractmethod
    def create_topic(self, name: str) -> DurableStreamTopic:
        """Create an isolated topic for one contract test."""

    @abstractmethod
    def make_cursor_unavailable(self, topic: DurableStreamTopic, cursor: TopicCursor) -> None:
        """Simulate retention making a previously valid cursor unavailable."""

    @abstractmethod
    def fail_next_append(self, topic: DurableStreamTopic) -> None:
        """Make the next append fail with the adapter's backend error."""

    @abstractmethod
    def fail_next_receive(self, subscription: DurableStreamSubscription) -> None:
        """Make the next receive fail with the adapter's backend error."""

    @abstractmethod
    def fail_next_enter_after_acquiring_resources(self, subscription: DurableStreamSubscription) -> None:
        """Make the next enter fail after acquiring adapter-owned resources."""

    @abstractmethod
    def assert_subscription_resources_released(self, subscription: DurableStreamSubscription) -> None:
        """Assert that the subscription holds no adapter-owned resources."""

    @staticmethod
    def receive_record(subscription: DurableStreamSubscription) -> DurableStreamRecord:
        result = subscription.receive(timeout=0.1)
        assert isinstance(result, DurableStreamRecord)
        return result

    def test_beginning_boundary_is_fixed_before_entry(self) -> None:
        topic = self.create_topic("beginning-boundary")
        topic.append(b"before-subscribe")
        subscription = topic.subscribe_from_beginning()
        topic.append(b"after-subscribe-before-entry")

        with subscription:
            assert self.receive_record(subscription).payload == b"before-subscribe"
            assert self.receive_record(subscription).payload == b"after-subscribe-before-entry"
            assert subscription.receive(timeout=0) is None

    def test_tail_boundary_is_fixed_before_entry(self) -> None:
        topic = self.create_topic("tail-boundary")
        topic.append(b"before-subscribe")
        subscription = topic.subscribe_from_tail()
        topic.append(b"after-subscribe-before-entry")

        with subscription:
            assert self.receive_record(subscription).payload == b"after-subscribe-before-entry"
            assert subscription.receive(timeout=0) is None

    def test_cursor_resume_is_strictly_exclusive(self) -> None:
        topic = self.create_topic("exclusive-cursor")
        topic.append(b"first")
        topic.append(b"second")

        with topic.subscribe_from_beginning() as initial_subscription:
            first = self.receive_record(initial_subscription)

        resumed_subscription = topic.subscribe_from_cursor(first.cursor)
        topic.append(b"third")

        with resumed_subscription:
            assert self.receive_record(resumed_subscription).payload == b"second"
            assert self.receive_record(resumed_subscription).payload == b"third"
            assert resumed_subscription.receive(timeout=0) is None

    def test_subscriptions_are_independent_and_ordered(self) -> None:
        topic = self.create_topic("independent-subscriptions")
        topic.append(b"first")
        topic.append(b"second")
        first_subscription = topic.subscribe_from_beginning()
        second_subscription = topic.subscribe_from_beginning()

        with first_subscription, second_subscription:
            first_payloads = [self.receive_record(first_subscription).payload for _ in range(2)]
            second_payloads = [self.receive_record(second_subscription).payload for _ in range(2)]

        assert first_payloads == [b"first", b"second"]
        assert second_payloads == [b"first", b"second"]

    def test_invalid_and_wrong_topic_cursors_are_rejected(self) -> None:
        topic = self.create_topic("cursor-owner")
        other_topic = self.create_topic("other-topic")
        topic.append(b"record")

        with topic.subscribe_from_beginning() as subscription:
            cursor = self.receive_record(subscription).cursor

        with pytest.raises(CursorUnavailableError):
            topic.subscribe_from_cursor(TopicCursor("malformed"))
        with pytest.raises(CursorUnavailableError):
            other_topic.subscribe_from_cursor(cursor)

    def test_cursor_unavailable_before_entry_is_terminal(self) -> None:
        topic = self.create_topic("unavailable-before-entry")
        topic.append(b"record")

        with topic.subscribe_from_beginning() as initial_subscription:
            cursor = self.receive_record(initial_subscription).cursor

        resumed_subscription = topic.subscribe_from_cursor(cursor)
        self.make_cursor_unavailable(topic, cursor)

        with pytest.raises(CursorUnavailableError):
            resumed_subscription.__enter__()
        self.assert_subscription_resources_released(resumed_subscription)
        assert resumed_subscription.receive(timeout=0) is CLOSED
        with pytest.raises(DurableStreamUnavailableError):
            resumed_subscription.__enter__()

    def test_enter_failure_is_mapped_releases_resources_and_is_terminal(self) -> None:
        topic = self.create_topic("enter-failure")
        subscription = topic.subscribe_from_tail()
        self.fail_next_enter_after_acquiring_resources(subscription)

        with pytest.raises(DurableStreamUnavailableError):
            subscription.__enter__()

        self.assert_subscription_resources_released(subscription)
        assert subscription.receive(timeout=0) is CLOSED
        with pytest.raises(DurableStreamUnavailableError):
            subscription.__enter__()

    def test_cursor_unavailable_during_delivery_is_terminal(self) -> None:
        topic = self.create_topic("unavailable-during-delivery")
        topic.append(b"first")
        topic.append(b"second")

        with topic.subscribe_from_beginning() as subscription:
            first = self.receive_record(subscription)
            self.make_cursor_unavailable(topic, first.cursor)

            with pytest.raises(CursorUnavailableError):
                subscription.receive(timeout=0)
            self.assert_subscription_resources_released(subscription)
            assert subscription.receive(timeout=0) is CLOSED

    def test_backend_receive_failure_is_mapped_and_terminal(self) -> None:
        topic = self.create_topic("receive-failure")
        subscription = topic.subscribe_from_tail()

        with subscription:
            self.fail_next_receive(subscription)
            with pytest.raises(DurableStreamUnavailableError):
                subscription.receive(timeout=0)
            self.assert_subscription_resources_released(subscription)
            assert subscription.receive(timeout=0) is CLOSED

    def test_backend_append_failure_is_mapped(self) -> None:
        topic = self.create_topic("append-failure")
        self.fail_next_append(topic)

        with pytest.raises(DurableStreamUnavailableError):
            topic.append(b"record")

    def test_slow_subscription_does_not_block_append_or_silently_drop_records(self) -> None:
        topic = self.create_topic("backpressure")
        subscription = topic.subscribe_from_tail()
        payloads = [f"record-{index}".encode() for index in range(64)]
        append_errors: queue.Queue[BaseException] = queue.Queue()

        def append_records() -> None:
            try:
                producer = topic.as_producer()
                for payload in payloads:
                    producer.append(payload)
            except BaseException as exc:
                append_errors.put(exc)

        with subscription:
            producer = threading.Thread(target=append_records)
            producer.start()
            producer.join(timeout=1)

            assert not producer.is_alive(), "a slow subscription blocked the producer"
            if not append_errors.empty():
                raise append_errors.get_nowait()

            for payload in payloads:
                try:
                    record = subscription.receive(timeout=1)
                except DurableStreamUnavailableError:
                    self.assert_subscription_resources_released(subscription)
                    assert subscription.receive(timeout=0) is CLOSED
                    return

                assert isinstance(record, DurableStreamRecord)
                assert record.payload == payload

    def test_close_is_idempotent_and_terminal(self) -> None:
        topic = self.create_topic("close")
        subscription = topic.subscribe_from_tail()

        with subscription:
            subscription.close()
            subscription.close()
            assert subscription.receive(timeout=0) is CLOSED
            self.assert_subscription_resources_released(subscription)

    def test_subscription_is_one_shot(self) -> None:
        topic = self.create_topic("one-shot")
        subscription = topic.subscribe_from_tail()

        with subscription:
            pass

        self.assert_subscription_resources_released(subscription)
        with pytest.raises(DurableStreamUnavailableError):
            subscription.__enter__()

    def test_closed_subscription_cannot_be_entered(self) -> None:
        topic = self.create_topic("closed-before-entry")
        subscription = topic.subscribe_from_tail()

        subscription.close()

        self.assert_subscription_resources_released(subscription)
        assert subscription.receive(timeout=0) is CLOSED
        with pytest.raises(DurableStreamUnavailableError):
            subscription.__enter__()

    def test_seal_is_idempotent_and_finalizes_the_stream(self) -> None:
        topic = self.create_topic("seal")
        topic.append(b"record")
        subscription = topic.subscribe_from_beginning()

        topic.seal()
        topic.seal()

        with pytest.raises(DurableStreamUnavailableError):
            topic.append(b"after-seal")

        with subscription:
            assert self.receive_record(subscription).payload == b"record"
            assert subscription.receive(timeout=0) is CLOSED
            self.assert_subscription_resources_released(subscription)
