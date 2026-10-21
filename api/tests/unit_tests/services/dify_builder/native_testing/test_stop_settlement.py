"""Actual evidence-read synchronization; no SQL/durable or cleanup proof."""

from threading import Event, Thread
from time import monotonic

import pytest

from services.dify_builder.native_testing.control import NativeControlRecord, NativePolicyStop
from services.dify_builder.native_testing.stop_settlement import NativeEvidenceReadGate


def gate_case():
    from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import LaunchCase

    case = LaunchCase()
    ref = case.state.context.ref
    record = NativeControlRecord(
        control=NativePolicyStop(ref=ref, reason_code="effect_denied"),
        node_id="http",
        native_execution_id="execution",
        carrier_ref="carrier",
    )
    owner = case.host.boundary_owner
    owner._begin(record)
    return NativeEvidenceReadGate(case.host), owner, record


def test_stop_waits_for_active_read_and_nested_read_finishes_without_deadlock():
    gate, owner, record = gate_case()
    outer, pending, nested, release, sealed = (Event() for _ in range(5))
    errors = []

    def reader():
        try:
            with gate.read():
                outer.set()
                assert pending.wait(1)
                deadline = monotonic() + 1
                with gate._condition:
                    while gate._record is None:
                        assert monotonic() < deadline
                        gate._condition.wait(0.01)
                # STOP has begun while this outer reader is doing private I/O.
                with gate.read():
                    nested.set()
                assert release.wait(1)
        except BaseException as error:
            errors.append(error)

    def stop():
        try:
            pending.set()
            gate.begin_stop(record=record, deadline=monotonic() + 2)
            sealed.set()
            gate.finish_stop(record=record, acknowledged=True)
            owner._accepted.add(record.carrier_ref)
        except BaseException as error:
            errors.append(error)

    first = Thread(target=reader)
    first.start()
    assert outer.wait(1)
    second = Thread(target=stop)
    second.start()
    assert nested.wait(1)
    assert not sealed.is_set()
    release.set()
    first.join(2)
    second.join(2)
    assert not first.is_alive()
    assert not second.is_alive()
    assert not errors
    assert sealed.is_set()
    with gate.read():
        assert owner.status == "STOP_RECORDED"


@pytest.mark.parametrize("acknowledged", [False, True])
def test_refused_or_unaccepted_ack_cannot_open_evidence_reads(acknowledged):
    gate, _owner, record = gate_case()
    gate.begin_stop(record=record, deadline=monotonic() + 0.03)
    gate.finish_stop(record=record, acknowledged=acknowledged)
    with pytest.raises(ValueError, match="native_stop_settlement_(late|unavailable)"):
        with gate.read():
            pytest.fail("unaccepted STOP acquired evidence authority")
