"""Exercise real TCP/TLS HTTP+JSON and SSE against the dedicated acceptance server."""

import base64
import ssl
import subprocess
import threading
import time
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

from providers.a2a.gateway import A2AGateway
from providers.a2a.transport import BoundedTransport
from services.external_agents.io_contracts import JsonObject, JsonValue
from services.external_agents.protocol import (
    TRACEABILITY_URI,
    BearerAuth,
    ConnectionSpec,
    GatewayError,
    GatewayReceipt,
    NoAuth,
    SendRequest,
)
from tests.e2e_tests.external_agents.fixture_server import FixtureServer, FixtureState

type HTTPSFixture = tuple[FixtureState, A2AGateway, httpx.Client]


class VerifiedHTTPSRequester:
    def __init__(self, client: httpx.Client) -> None:
        self.client = client

    def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        assert kwargs["max_retries"] == 0
        assert kwargs["ssl_verify"] is True
        headers, content, timeout = kwargs["headers"], kwargs["content"], kwargs["timeout"]
        assert isinstance(headers, dict)
        assert isinstance(content, bytes) or content is None
        assert isinstance(timeout, httpx.Timeout)
        request = self.client.build_request(method, url, headers=headers, content=content, timeout=timeout)
        return self.client.send(request, stream=True, follow_redirects=False)


@pytest.fixture
def https_fixture(tmp_path: Path) -> Generator[HTTPSFixture]:
    key, certificate = tmp_path / "fixture.key", tmp_path / "fixture.crt"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=DNS:localhost,IP:127.0.0.1",
            "-keyout",
            str(key),
            "-out",
            str(certificate),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    state = FixtureState(public_url="https://127.0.0.1", bearer=uuid4().hex)
    server = FixtureServer(("127.0.0.1", 0), state)
    state.public_url += f":{server.server_port}"
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
    thread.start()
    with httpx.Client(verify=ssl.create_default_context(cafile=str(certificate)), trust_env=False) as client:
        yield state, A2AGateway(BoundedTransport(VerifiedHTTPSRequester(client))), client
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def request(scenario: str) -> SendRequest:
    return SendRequest(message_id=str(uuid4()), parts=({"text": f"[byoa:{scenario}:unit] Controlled test"},))


def connection(state: FixtureState) -> ConnectionSpec:
    return ConnectionSpec(
        endpoint=state.public_url,
        interface_url=state.public_url + "/a2a",
        authentication=NoAuth(),
        enabled_extensions=(TRACEABILITY_URI,),
    )


def known_task(receipt: GatewayReceipt) -> str:
    identifier = receipt.task_id
    assert identifier is not None
    return identifier


def json_object(value: JsonValue) -> JsonObject:
    assert isinstance(value, dict)
    return value


def json_array(value: JsonValue) -> list[JsonValue]:
    assert isinstance(value, list)
    return value


def artifact(receipt: GatewayReceipt, index: int) -> JsonObject:
    return json_object(json_array(receipt.payload["artifacts"])[index])


def test_verified_https_fixture_supports_real_gateway_verify_message_sse_task_cancel_and_unknown(
    https_fixture: HTTPSFixture,
) -> None:
    state, gateway, _client = https_fixture
    spec = connection(state)
    assert gateway.verify(spec).auth_check == "not_exercised"
    assert state.snapshot()["counts"]["send"] == 0
    assert gateway.send(spec, request("direct"), streaming=True).kind == "message"
    completed = gateway.send(spec, request("completed"), streaming=True)
    assert completed.state == "TASK_STATE_COMPLETED"
    working = gateway.send(spec, request("working"), streaming=True)
    assert working.state == "TASK_STATE_WORKING"
    assert gateway.get_task(spec, known_task(working)).state == "TASK_STATE_COMPLETED"
    hold = gateway.send(spec, request("hold"), streaming=True)
    assert gateway.cancel_task(spec, known_task(hold)).state == "TASK_STATE_CANCELED"
    with pytest.raises(GatewayError) as error:
        gateway.send(spec, request("unknown"), streaming=True)
    assert error.value.submission_unknown is True
    stats = state.snapshot()
    assert all(message["sends"] == 1 for message in stats["messages"].values())
    assert stats["counts"]["send"] == 5
    assert stats["counts"]["subscribe"] == 0


def test_protected_https_card_and_traceability_shape_interoperate_with_the_real_gateway(
    https_fixture: HTTPSFixture,
) -> None:
    state, gateway, _client = https_fixture
    spec = ConnectionSpec(
        endpoint=state.public_url + "/bearer/.well-known/agent-card.json",
        interface_url=state.public_url + "/bearer/a2a",
        authentication=BearerAuth(state.bearer),
        enabled_extensions=(TRACEABILITY_URI,),
    )
    assert gateway.verify(spec).auth_check == "passed_for_read_endpoint"
    receipt = gateway.send(spec, request("trace"), streaming=True)
    trace = artifact(receipt, 1)
    assert trace["extensions"] == [TRACEABILITY_URI]
    part = json_object(json_array(trace["parts"])[0])
    assert set(json_object(part["data"])) == {"trace_id", "steps"}
    assert state.bearer not in str(receipt.payload)


def test_https_fixture_phoenix_verify_and_independent_dual_export_ack(https_fixture: HTTPSFixture) -> None:
    state, _gateway, client = https_fixture
    for prefix in ("asset", "app"):
        projects = client.get(f"{state.public_url}/{prefix}/v1/projects?limit=1")
        assert projects.json() == {"data": [], "next_cursor": None}
        response = client.post(
            f"{state.public_url}/{prefix}/v1/traces",
            content=b"\x0a\x00",
            headers={"Content-Type": "application/x-protobuf"},
        )
        assert response.status_code == 200
        assert response.headers["Content-Type"] == "application/x-protobuf"
        assert response.content == b""
    assert [entry["path"] for entry in state.snapshot()["exports"]] == ["/asset/v1/traces", "/app/v1/traces"]


def test_https_admin_release_can_return_late_file_output_for_page_lifecycle_acceptance(
    https_fixture: HTTPSFixture,
) -> None:
    state, gateway, client = https_fixture
    spec = connection(state)
    task = gateway.send(spec, request("hold"), streaming=True)
    released = client.post(
        state.public_url + "/admin/release", json={"task_id": task.task_id, "output_scenario": "file-output"}
    )
    assert released.status_code == 200
    receipt = gateway.get_task(spec, known_task(task))
    assert receipt.state == "TASK_STATE_COMPLETED"
    output = artifact(receipt, 0)
    assert output["name"] == "report"
    assert json_object(json_array(output["parts"])[0])["mediaType"] == "application/pdf"


def test_crash_before_receipt_records_acceptance_without_response_until_admin_release(
    https_fixture: HTTPSFixture,
) -> None:
    state, _gateway, client = https_fixture
    state.barrier_seconds = 3
    message_id = str(uuid4())
    payload = {
        "message": {
            "messageId": message_id,
            "role": "ROLE_USER",
            "parts": [{"text": "[byoa:crash-before-receipt:unit]"}],
        }
    }
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(client.post, state.public_url + "/a2a/message:send", json=payload)
        deadline = time.monotonic() + 2
        snapshot = state.snapshot()
        while message_id not in snapshot["messages"] and time.monotonic() < deadline:
            time.sleep(0.01)
            snapshot = state.snapshot()
        assert snapshot["messages"][message_id]["sends"] == 1
        task_id = snapshot["messages"][message_id]["created_task_id"]
        assert snapshot["tasks"][task_id]["receipt_barrier"] == "waiting"
        assert snapshot["tasks"][task_id]["receipt_started"] is False
        assert not pending.done()
        released = client.post(state.public_url + "/admin/release", json={"message_id": message_id})
        assert released.status_code == 200
        response = pending.result(timeout=4)
        assert response.status_code == 200
        assert response.json()["task"]["id"] == task_id
    assert state.snapshot()["tasks"][task_id]["receipt_barrier"] == "released"


def test_crash_receipt_barrier_is_independently_bounded_and_maximum_is_enforced(https_fixture: HTTPSFixture) -> None:
    state, _gateway, client = https_fixture
    state.barrier_seconds = 0.03
    message_id = str(uuid4())
    response = client.post(
        state.public_url + "/a2a/message:send",
        json={
            "message": {
                "messageId": message_id,
                "role": "ROLE_USER",
                "parts": [{"text": "[byoa:crash-before-receipt:unit]"}],
            }
        },
    )
    assert response.status_code == 200
    task_id = response.json()["task"]["id"]
    assert state.snapshot()["tasks"][task_id]["receipt_barrier"] == "timed_out"
    with pytest.raises(ValueError, match="60 seconds"):
        FixtureState(public_url="https://127.0.0.1", barrier_seconds=61)


@pytest.mark.parametrize("confirm_first", [True, False])
def test_timeout_retry_fixture_associates_new_attempt_and_cancellation_order_with_txt_bytes(
    https_fixture: HTTPSFixture, confirm_first: bool
) -> None:
    state, gateway, _client = https_fixture
    spec = connection(state)
    content = b"retry TXT bytes"
    first_request = SendRequest(
        message_id=str(uuid4()),
        parts=(
            {"text": "[byoa:timeout-retry:unit]"},
            {"raw": base64.b64encode(content).decode(), "mediaType": "text/plain", "filename": "retry.txt"},
        ),
    )
    first = gateway.send(spec, first_request, streaming=True)
    assert first.state == "TASK_STATE_WORKING"
    assert gateway.get_task(spec, known_task(first)).state == "TASK_STATE_WORKING"
    if confirm_first:
        assert gateway.cancel_task(spec, known_task(first)).state == "TASK_STATE_CANCELED"
    second_request = SendRequest(message_id=str(uuid4()), parts=first_request.parts)
    second = gateway.send(spec, second_request, streaming=True)
    assert second.state == "TASK_STATE_COMPLETED"
    evidence = state.snapshot()["messages"][second_request.message_id]
    assert evidence["attempt"] == 2
    assert evidence["previous_task_state_at_send"] == ("TASK_STATE_CANCELED" if confirm_first else "TASK_STATE_WORKING")
    assert evidence["input_files"][0]["size"] == len(content)


def test_five_fixed_capacity_cards_have_distinct_verified_immutable_interfaces(https_fixture: HTTPSFixture) -> None:
    state, gateway, client = https_fixture
    interfaces = set()
    for number in range(1, 6):
        prefix = f"/capacity-{number}"
        endpoint = state.public_url + prefix + "/.well-known/agent-card.json"
        discovered = gateway.verify(ConnectionSpec(endpoint=endpoint, authentication=NoAuth()))
        assert discovered.interface_url == state.public_url + prefix + "/a2a/v1"
        interfaces.add(discovered.interface_url)
        spec = ConnectionSpec(endpoint=endpoint, interface_url=discovered.interface_url, authentication=NoAuth())
        task = gateway.send(spec, request("hold"), streaming=True)
        assert gateway.get_task(spec, known_task(task)).state == "TASK_STATE_WORKING"
        assert gateway.cancel_task(spec, known_task(task)).state == "TASK_STATE_CANCELED"
    assert len(interfaces) == 5
    assert client.get(state.public_url + "/capacity-6/.well-known/agent-card.json").status_code == 404
