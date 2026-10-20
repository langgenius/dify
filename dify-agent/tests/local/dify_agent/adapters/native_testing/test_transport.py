"""Real HTTPX final-send behavior; MockTransport replaces only external network."""

import asyncio
import base64
import importlib
import json

import httpx
import pytest

from dify_agent.protocol.native_testing import AgentRuntimeIdentity


def api():
    # Deliberately import inside cases: baseline RED is a missing production owner.
    return importlib.import_module("dify_agent.adapters.native_testing.transport")


def identity(run="run-A", *, native=False, generation=0):
    return AgentRuntimeIdentity(
        run_id=run,
        agent_generation=generation,
        request_digest="a" * 64,
        execution_mode="builder_test" if native else "ordinary",
        parent_node={
            "ref": {
                "policy_version": "builder-native-test-v1",
                "request_id": "request",
                "invocation_id": "invocation",
                "context_digest": "b" * 64,
            },
            "execution_id": "4c959aea-9025-4db9-9361-eed1191c11c7",
            "input_result_ref": "input",
            "input_digest": "c" * 64,
        }
        if native
        else None,
    )


def selection(request):
    value = request.headers["X-Dify-Agent-Run"]
    return json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))


def test_request_stream_and_prebuilt_send_ignore_all_body_markers():
    async def exercise():
        m = api()
        seen = []

        def receive(request):
            seen.append((dict(request.headers), selection(request), json.loads(request.content)))
            return httpx.Response(200, content=b"data: one\n\ndata: two\n\n")

        async with m.AgentRuntimeHTTPClient(
            api_url="http://api:5001", api_token="backend", transport=httpx.MockTransport(receive)
        ) as client:
            original = httpx.Request("POST", "http://api:5001/inner/api/agent/runtime/llm/invoke", json={})
            with m.bind_runtime_identity(identity(native=True, generation=3)):
                await client.post(str(original.url), json={})
                async with client.stream("POST", str(original.url), json={}) as response:
                    assert [line async for line in response.aiter_lines()] == ["data: one", "", "data: two", ""]
                await client.send(original)
            assert "Authorization" not in original.headers
            assert "X-Dify-Agent-Run" not in original.headers
        assert len(seen) == 3
        for headers, selected, body in seen:
            assert headers["authorization"] == "Bearer backend"
            assert "x-inner-api-key" not in headers
            assert selected["agent_run_id"] == "run-A"
            assert selected["agent_generation"] == 3
            assert selected["parent_node"]["input_result_ref"] == "input"
            assert body == {}

    asyncio.run(exercise())


def test_missing_binding_and_detached_task_after_owner_exit_refuse_locally():
    async def exercise():
        m = api()
        seen = []
        async with m.AgentRuntimeHTTPClient(
            api_url="http://api:5001",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200)),
        ) as client:
            with pytest.raises(m.AgentRuntimeTransportError):
                await client.post("http://api:5001/inner/api/agent/runtime/tools/invoke", json={})
            ready = asyncio.Event()

            async def detached():
                await ready.wait()
                with pytest.raises(m.AgentRuntimeTransportError):
                    await client.post("http://api:5001/inner/api/agent/runtime/tools/invoke", json={})

            with m.bind_runtime_identity(identity()):
                task = asyncio.create_task(detached())
            ready.set()
            await task
        assert seen == []

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "url,method",
    [
        ("http://evil/inner/api/agent/runtime/tools/invoke", "POST"),
        ("https://api:5001/inner/api/agent/runtime/tools/invoke", "POST"),
        ("http://api:5002/inner/api/agent/runtime/tools/invoke", "POST"),
        ("http://name:secret@api:5001/inner/api/agent/runtime/tools/invoke", "POST"),
        ("http://api:5001/inner/api/agent/tools/invoke", "POST"),
        ("http://api:5001/plugin/tenant/dispatch/tool/invoke", "POST"),
        ("http://api:5001/inner/api/agent/runtime/tools/invoke", "GET"),
        ("http://api:5001/inner/api/agent/runtime/tools/invoke/", "POST"),
        ("http://api:5001/inner/api/agent/runtime/llm%2finvoke", "POST"),
        ("http://api:5001/inner/api/agent/runtime/files/download-request?signature=secret", "POST"),
    ],
)
def test_destination_method_and_signed_url_do_not_acquire_authority(url, method):
    async def exercise():
        m = api()
        seen = []
        async with m.AgentRuntimeHTTPClient(
            api_url="http://api:5001",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200)),
        ) as client:
            with m.bind_runtime_identity(identity(native=True)):
                with pytest.raises(m.AgentRuntimeTransportError):
                    await client.request(method, url, json={})
        assert seen == []

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "header", ["Authorization", "X-Dify-Agent-Run", "X-Inner-Api-Key", "X-Api-Key", "Proxy-Authorization"]
)
def test_supplied_auth_selection_or_legacy_headers_refuse(header):
    async def exercise():
        m = api()
        seen = []
        async with m.AgentRuntimeHTTPClient(
            api_url="http://api:5001",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200)),
        ) as client:
            with m.bind_runtime_identity(identity()):
                with pytest.raises(m.AgentRuntimeTransportError):
                    await client.post(
                        "http://api:5001/inner/api/agent/runtime/tools/invoke",
                        headers=[(header, "foreign"), (header, "duplicate")],
                        json={},
                    )
        assert seen == []

    asyncio.run(exercise())


def test_redirect_never_forwards_authority_even_with_follow_redirects_requested():
    async def exercise():
        m = api()
        seen = []

        def receive(request):
            seen.append(str(request.url))
            return httpx.Response(307, headers={"Location": "http://evil/steal"})

        async with m.AgentRuntimeHTTPClient(
            api_url="http://api:5001", api_token="backend", transport=httpx.MockTransport(receive)
        ) as client:
            with m.bind_runtime_identity(identity()):
                with pytest.raises(m.AgentRuntimeTransportError):
                    await client.post(
                        "http://api:5001/inner/api/agent/runtime/tools/invoke", json={}, follow_redirects=True
                    )
        assert seen == ["http://api:5001/inner/api/agent/runtime/tools/invoke"]

    asyncio.run(exercise())


def test_cached_prebuilt_request_uses_current_binding_but_caller_mismatch_refuses():
    async def exercise():
        m = api()
        seen = []
        async with m.AgentRuntimeHTTPClient(
            api_url="http://api:5001",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(selection(req)) or httpx.Response(200)),
        ) as client:
            cached = client.build_request("POST", "http://api:5001/inner/api/agent/runtime/tools/invoke", json={})
            with m.bind_runtime_identity(identity()):
                await client.send(cached)
            with m.bind_runtime_identity(identity("run-B", native=True)):
                await client.send(cached)
                with pytest.raises(m.AgentRuntimeTransportError):
                    await client.post(str(cached.url), json={"caller": {"agent_run_id": "run-A"}})
        assert [item["agent_run_id"] for item in seen] == ["run-A", "run-B"]

    asyncio.run(exercise())


def test_concurrent_scopes_nested_misuse_exception_and_cancellation_do_not_leak():
    async def exercise():
        m = api()
        seen = []
        barrier = asyncio.Event()
        async with m.AgentRuntimeHTTPClient(
            api_url="http://api:5001",
            api_token="backend",
            transport=httpx.MockTransport(lambda req: seen.append(selection(req)) or httpx.Response(200)),
        ) as client:

            async def run(name):
                with m.bind_runtime_identity(identity(name)):
                    with pytest.raises(m.AgentRuntimeTransportError):
                        with m.bind_runtime_identity(identity("foreign")):
                            pass
                    await barrier.wait()
                    await client.post("http://api:5001/inner/api/agent/runtime/tools/invoke", json={})

            a, b = asyncio.create_task(run("run-A")), asyncio.create_task(run("run-B"))
            barrier.set()
            await asyncio.gather(a, b)

            async def cancel():
                with m.bind_runtime_identity(identity("cancelled")):
                    raise asyncio.CancelledError

            with pytest.raises(asyncio.CancelledError):
                await cancel()
            with pytest.raises(RuntimeError):
                with m.bind_runtime_identity(identity("exception")):
                    raise RuntimeError("owner failed")
            with pytest.raises(m.AgentRuntimeTransportError):
                await client.post("http://api:5001/inner/api/agent/runtime/tools/invoke", json={})
        assert sorted(item["agent_run_id"] for item in seen) == ["run-A", "run-B"]

    asyncio.run(exercise())


def test_daemon_transport_refuses_native_without_effect_markers_and_after_exit():
    async def exercise():
        m = api()
        seen = []
        async with httpx.AsyncClient(
            transport=m.LegacyPluginDaemonTransport(
                httpx.MockTransport(lambda req: seen.append(req) or httpx.Response(200))
            )
        ) as client:
            with m.bind_runtime_identity(identity(native=True)):
                with pytest.raises(m.AgentRuntimeTransportError):
                    await client.post("http://daemon/plugin/tenant/dispatch/tool/invoke", json={})
            with m.bind_runtime_identity(identity()):
                await client.post("http://daemon/plugin/tenant/dispatch/tool/invoke", json={})
        assert len(seen) == 1

    asyncio.run(exercise())


def test_inherited_send_waiting_for_body_cannot_dispatch_after_owner_exit():
    async def exercise():
        m = api()
        started, release = asyncio.Event(), asyncio.Event()
        seen = []

        async def body():
            started.set()
            await release.wait()
            yield b"{}"

        async with m.AgentRuntimeHTTPClient(
            api_url="http://api",
            api_token="backend",
            transport=httpx.MockTransport(lambda request: seen.append(request) or httpx.Response(200)),
        ) as client:
            with m.bind_runtime_identity(identity()):
                request = client.build_request(
                    "POST", "http://api/inner/api/agent/runtime/tools/invoke", content=body()
                )
                task = asyncio.create_task(client.send(request))
                await started.wait()
            release.set()
            with pytest.raises(m.AgentRuntimeTransportError):
                await task
        assert seen == []

    asyncio.run(exercise())
