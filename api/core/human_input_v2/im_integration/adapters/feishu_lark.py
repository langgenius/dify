"""Shared Feishu/Lark adapter implementation.

The module deliberately keeps Provider credentials and the start/stop stream
contract outside the public ``im_provider`` package. Feishu and Lark wrappers
share every behavior except their typed credential, Provider discriminator,
and official SDK domain.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
import threading
import time
from collections import deque
from collections.abc import Awaitable, Callable, Mapping, Sequence
from concurrent.futures import Future
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import ClassVar, Literal, Never, Protocol, override, runtime_checkable
from urllib.parse import parse_qs, urlsplit

import lark_oapi as lark
from cryptography.hazmat.primitives import padding as symmetric_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from lark_oapi.api import contact, im, tenant
from lark_oapi.api.im.v1.model.p2_im_message_receive_v1 import P2ImMessageReceiveV1
from lark_oapi.channel import FeishuChannel, TransportConfig
from lark_oapi.event.callback.model.p2_card_action_trigger import P2CardActionTrigger, P2CardActionTriggerResponse
from lark_oapi.ws import client as sdk_ws_client_module
from markdown_it import MarkdownIt
from markdown_it.token import Token
from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, ValidationError, field_validator
from websockets.asyncio.client import ClientConnection

from configs import dify_config
from core.human_input import ButtonStyle
from core.human_input_v2 import FileInput, FileListInput, MarkdownText, ParagraphInput, ResolvedForm, SelectInput
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_provider import (
    AuthenticatedIMEvent,
    CardAssessment,
    CorrelationToken,
    CredentialTestFailure,
    CredentialTestFailureKind,
    CredentialTestSuccess,
    Directory,
    DirectoryEntry,
    DirectoryReadFailure,
    DynamicCardMessagingError,
    EventAcceptance,
    IMCardEvent,
    IMCardEventDecoder,
    IMCardEventDecodeResult,
    IMCardEventDecodingError,
    IMDirectory,
    IMDynamicCardMessaging,
    IMEventConsumer,
    IMMessaging,
    IMStreamStartError,
    IMStreamStopError,
    IMWebhookHandler,
    MessageAccepted,
    MessageReference,
    MessageSendingError,
    MessageSendingResult,
    ProviderUserId,
    ReplacementError,
    ReplacementErrorKind,
    StaticCardIntent,
    UnrecognizedIMEvent,
    WebhookRequest,
    WebhookResponse,
)

logger = logging.getLogger(__name__)

_FEISHU_DOMAIN = "https://open.feishu.cn"
_LARK_DOMAIN = "https://open.larksuite.com"
_DIRECTORY_PAGE_SIZE = 50
type _DepartmentIdType = Literal["department_id", "open_department_id"]


@dataclass(frozen=True, slots=True)
class _DepartmentIdentity:
    value: str
    id_type: _DepartmentIdType


_ROOT_DEPARTMENT = _DepartmentIdentity("0", "department_id")
_AUTHENTICATION_REJECTED_CODES = frozenset((99991663, 99991664, 99991665))
_STALE_MESSAGE_CODES = frozenset((230001, 230011, 230020))
_REFERENCE_VERSION: Literal[1] = 1
_REFERENCE_KIND_TEXT: Literal["text"] = "text"
_REFERENCE_KIND_DYNAMIC_CARD: Literal["dynamic_card"] = "dynamic_card"
_REFERENCE_SIGNING_CONTEXT = b"dify:human-input-v2:feishu-lark-message-reference:v1"
_WEBHOOK_REPLAY_CLAIM_TTL_SECONDS = 300
_WEBHOOK_REPLAY_CACHE_CAPACITY = 4096
_JSON_RESPONSE_HEADERS = (("Content-Type", "application/json"),)
_STREAM_READY_TIMEOUT_SECONDS = 30.0
_STREAM_CLOSE_TIMEOUT_SECONDS = 5.0
_MILLISECONDS_PER_SECOND = 1_000
_MICROSECONDS_PER_SECOND = 1_000_000
_MILLISECOND_TIMESTAMP_DIGITS = 13
_MICROSECOND_TIMESTAMP_DIGITS = 16
_COMMONMARK_PARSER = MarkdownIt("commonmark", {"html": False})
_AUTHENTICATED_WEBHOOK_PAYLOAD_KEY = "__dify_feishu_lark.webhook"
_AUTHENTICATED_STREAM_PAYLOAD_KEY = "__dify_feishu_lark.stream"
_CARD_ACTION_TRIGGER_OBJECT_TYPE = "lark_oapi.event.callback.model.p2_card_action_trigger.P2CardActionTrigger"


def _log_safe_error(message: str, *, extra: Mapping[str, object] | None = None) -> None:
    """Log only static diagnostics, never the active Provider exception."""

    logger.error(message, extra=extra)


class _FeishuLarkIMIntegrationCredentials(BaseModel):
    """Strict immutable resolved credentials bound to one adapter lifetime."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        hide_input_in_errors=True,
    )

    app_id: str = Field(min_length=1, description="Provider application identifier.")
    app_secret: str = Field(min_length=1, repr=False, description="Resolved application secret.")
    verification_token: str | None = Field(
        default=None,
        min_length=1,
        repr=False,
        description="Resolved callback verification token.",
    )
    encrypt_key: str | None = Field(
        default=None,
        min_length=1,
        repr=False,
        description="Resolved callback encryption key.",
    )


class FeishuIMIntegrationCredentials(_FeishuLarkIMIntegrationCredentials):
    """Resolved Feishu credentials; intentionally not package-exported."""

    provider: Literal[IMProvider.FEISHU] = Field(description="Feishu credential discriminator.")


class LarkIMIntegrationCredentials(_FeishuLarkIMIntegrationCredentials):
    """Resolved Lark credentials; intentionally not package-exported."""

    provider: Literal[IMProvider.LARK] = Field(description="Lark credential discriminator.")


class _SDKGateway(Protocol):
    """Narrow synchronous boundary over official generated SDK resources."""

    def query_tenant(self) -> Mapping[str, object]: ...

    def list_scope(self, page_token: str | None) -> Mapping[str, object]: ...

    def list_departments(self, department: _DepartmentIdentity, page_token: str | None) -> Mapping[str, object]: ...

    def list_users(self, department: _DepartmentIdentity, page_token: str | None) -> Mapping[str, object]: ...

    def create_message(self, receive_id: str, msg_type: str, content: str) -> Mapping[str, object]: ...

    def patch_message(self, message_id: str, content: str) -> Mapping[str, object]: ...


@dataclass(frozen=True, slots=True)
class _SDKEventEnvelope:
    native_payload: str
    object_type: str
    provider_tenant_id: str
    event_id: str | None
    event_type: str | None
    occurred_at: datetime | None
    is_card_action: bool


type _StreamDeliveryCallback = Callable[[_SDKEventEnvelope, Callable[[], None]], None]


@runtime_checkable
class _SDKWireWriter(Protocol):
    _write_message: Callable[[bytes], Awaitable[None]]


class _OfficialSDKGateway(_SDKGateway):
    """Translate official SDK response objects into validation-local mappings."""

    def __init__(self, credentials: _FeishuLarkIMIntegrationCredentials, domain: str) -> None:
        client = (
            lark.Client.builder()
            .app_id(credentials.app_id)
            .app_secret(credentials.app_secret)
            .domain(domain)
            .log_level(lark.LogLevel.ERROR)
            .build()
        )
        tenant_service = client.tenant
        contact_service = client.contact
        im_service = client.im
        if tenant_service is None or contact_service is None or im_service is None:
            raise RuntimeError("official SDK client did not initialize required services")
        self._tenant_service = tenant_service
        self._contact_service = contact_service
        self._im_service = im_service

    @override
    def query_tenant(self) -> Mapping[str, object]:
        request = tenant.v2.QueryTenantRequest.builder().build()
        return _sdk_response_mapping(self._tenant_service.v2.tenant.query(request))

    @override
    def list_scope(self, page_token: str | None) -> Mapping[str, object]:
        builder = (
            contact.v3.ListScopeRequest.builder()
            .page_size(_DIRECTORY_PAGE_SIZE)
            .department_id_type("department_id")
            .user_id_type("union_id")
        )
        if page_token is not None:
            builder = builder.page_token(page_token)
        return _sdk_response_mapping(self._contact_service.v3.scope.list(builder.build()))

    @override
    def list_departments(self, department: _DepartmentIdentity, page_token: str | None) -> Mapping[str, object]:
        builder = (
            contact.v3.ChildrenDepartmentRequest.builder()
            .department_id_type(department.id_type)
            .user_id_type("union_id")
            .fetch_child(False)
            .page_size(_DIRECTORY_PAGE_SIZE)
        )
        if page_token is not None:
            builder = builder.page_token(page_token)
        request = builder.build()
        request.paths["department_id"] = department.value
        return _sdk_response_mapping(self._contact_service.v3.department.children(request))

    @override
    def list_users(self, department: _DepartmentIdentity, page_token: str | None) -> Mapping[str, object]:
        builder = (
            contact.v3.FindByDepartmentUserRequest.builder()
            .department_id(department.value)
            .department_id_type(department.id_type)
            .user_id_type("union_id")
            .page_size(_DIRECTORY_PAGE_SIZE)
        )
        if page_token is not None:
            builder = builder.page_token(page_token)
        return _sdk_response_mapping(self._contact_service.v3.user.find_by_department(builder.build()))

    @override
    def create_message(self, receive_id: str, msg_type: str, content: str) -> Mapping[str, object]:
        body = (
            im.v1.CreateMessageRequestBody.builder().receive_id(receive_id).msg_type(msg_type).content(content).build()
        )
        request = im.v1.CreateMessageRequest.builder().receive_id_type("union_id").request_body(body).build()
        return _sdk_response_mapping(self._im_service.v1.message.create(request))

    @override
    def patch_message(self, message_id: str, content: str) -> Mapping[str, object]:
        body = im.v1.PatchMessageRequestBody.builder().content(content).build()
        request = im.v1.PatchMessageRequest.builder().message_id(message_id).request_body(body).build()
        return _sdk_response_mapping(self._im_service.v1.message.patch(request))


def _create_sdk_gateway(
    credentials: _FeishuLarkIMIntegrationCredentials,
    domain: str,
) -> _SDKGateway:
    return _OfficialSDKGateway(credentials, domain)


class _PerClientSDKWSClient(sdk_ws_client_module.Client):
    """Bind the official SDK transport lifecycle to one client-owned loop.

    The 1.7.2 SDK hard-codes a module-level loop in ``start()``, ``_connect()``,
    and ``_receive_message_loop()``. It exposes no loop injection point, so
    this compatibility seam preserves the official handshake, frame handling,
    and reconnect implementation while replacing only those three scheduling
    decisions. The exact SDK version and these private shapes are protected by
    boundary tests.
    """

    _conn: ClientConnection | None

    def __init__(
        self,
        *,
        credentials: _FeishuLarkIMIntegrationCredentials,
        domain: str,
        event_handler: lark.EventDispatcherHandler,
    ) -> None:
        self._dify_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._dify_loop)
        try:
            super().__init__(
                credentials.app_id,
                credentials.app_secret,
                log_level=lark.LogLevel.ERROR,
                event_handler=event_handler,
                domain=domain,
                auto_reconnect=False,
                extra_ua_tags=["channel"],
            )
        except Exception:
            self._dify_loop.close()
            raise
        self._dify_lifecycle_lock = threading.Lock()
        self._dify_stopping = False

    @override
    def start(self) -> None:
        with self._dify_lifecycle_lock:
            if self._dify_stopping:
                self._close_owned_loop()
                return
        try:
            try:
                self._dify_loop.run_until_complete(self._connect())
            except Exception:
                self._dify_loop.run_until_complete(self._disconnect())
                raise
            self._dify_loop.create_task(self._ping_loop())
            self._dify_loop.run_forever()
        finally:
            self._close_owned_loop()

    @override
    async def _connect(self) -> None:
        await self._lock.acquire()
        try:
            if self._conn is not None:
                return
            connection_url = self._get_conn_url()
            parsed_url = urlsplit(connection_url)
            query = parse_qs(parsed_url.query)
            connection_id = query[sdk_ws_client_module.DEVICE_ID][0]
            service_id = query[sdk_ws_client_module.SERVICE_ID][0]

            connection = await sdk_ws_client_module.websockets.connect(connection_url, proxy=None)
            self._conn = connection
            self._conn_url = connection_url
            self._conn_id = connection_id
            self._service_id = service_id
            self._dify_loop.create_task(self._receive_message_loop())
        except sdk_ws_client_module.InvalidHandshake as exc:
            sdk_ws_client_module._parse_ws_conn_exception(exc)
        finally:
            self._lock.release()

    @override
    async def _receive_message_loop(self) -> None:
        try:
            while True:
                connection = self._conn
                if connection is None:
                    raise sdk_ws_client_module.ConnectionClosedException("connection is closed")
                message = await connection.recv()
                if not isinstance(message, bytes):
                    raise sdk_ws_client_module.ConnectionClosedException("received a non-binary SDK frame")
                self._dify_loop.create_task(self._handle_message(message))
        except Exception:
            await self._disconnect()
            if self._dify_stopping:
                return
            if self._auto_reconnect:
                await self._reconnect()
                return
            raise

    def stop(self) -> None:
        with self._dify_lifecycle_lock:
            self._dify_stopping = True
        if self._dify_loop.is_closed():
            return
        if self._dify_loop.is_running():
            disconnect = asyncio.run_coroutine_threadsafe(self._disconnect(), self._dify_loop)
            try:
                disconnect.result(timeout=_STREAM_CLOSE_TIMEOUT_SECONDS)
            finally:
                self._dify_loop.call_soon_threadsafe(self._dify_loop.stop)
            return
        self._dify_loop.run_until_complete(self._disconnect())

    def _close_owned_loop(self) -> None:
        pending_tasks = asyncio.all_tasks(self._dify_loop)
        for task in pending_tasks:
            task.cancel()
        if pending_tasks:
            self._dify_loop.run_until_complete(asyncio.gather(*pending_tasks, return_exceptions=True))
        self._dify_loop.run_until_complete(self._dify_loop.shutdown_asyncgens())
        self._dify_loop.run_until_complete(self._dify_loop.shutdown_default_executor())
        self._dify_loop.close()
        asyncio.set_event_loop(None)


class _SynchronousEventChannel(FeishuChannel):
    """Official lifecycle wrapper with a synchronous responsibility callback.

    ``FeishuChannel`` exposes ready/stop semantics but its built-in dispatcher
    schedules user callbacks after the SDK has already chosen an ACK. The SDK
    does not expose public dispatcher injection or wire-write completion hooks,
    so the contained compatibility seams below keep the official transport
    while making consumer responsibility and completed ACK writes observable.
    Their SDK compatibility is protected by focused boundary tests.
    """

    _ws_client: sdk_ws_client_module.Client | None

    def __init__(
        self,
        *,
        credentials: _FeishuLarkIMIntegrationCredentials,
        domain: str,
        callback: _StreamDeliveryCallback,
    ) -> None:
        self._dify_credentials = credentials
        self._dify_callback = callback
        self._wire_ack_condition = threading.Condition()
        self._pending_wire_acks: set[threading.Event] = set()
        self._current_wire_ack: ContextVar[threading.Event | None] = ContextVar(
            "feishu_lark_current_wire_ack",
            default=None,
        )
        self._wire_ack_tracking_enabled = False
        self._wire_ack_hook_installed = threading.Event()
        self._transport_lifecycle_lock = threading.Lock()
        self._transport_stop_requested = threading.Event()
        super().__init__(
            app_id=credentials.app_id,
            app_secret=credentials.app_secret,
            encrypt_key=credentials.encrypt_key,
            verification_token=credentials.verification_token,
            domain=domain,
            log_level=lark.LogLevel.ERROR,
            # The high-level SDK channel owns dispatcher/background concerns;
            # the per-client compatibility transport below owns the WS loop.
            transport=TransportConfig(kind="webhook", auto_reconnect=False),
        )

    @override
    async def connect_until_ready(self, *, timeout: float | None = 30.0) -> None:
        self._wire_ack_tracking_enabled = True
        running_loop = asyncio.get_running_loop()
        start_future = running_loop.run_in_executor(None, self.start)
        deadline = None if timeout is None else running_loop.time() + timeout
        try:
            while not start_future.done():
                ws_client = self._ws_client
                if ws_client is not None and ws_client._conn is not None:
                    self._install_wire_ack_hook(ws_client)
                    return
                if deadline is not None and running_loop.time() >= deadline:
                    self.stop()
                    raise TimeoutError("official SDK stream did not become ready before the deadline")
                await asyncio.sleep(0.01)
            await start_future
            raise RuntimeError("official SDK stream exited before becoming ready")
        finally:
            self._wire_ack_hook_installed.set()

    @override
    def start(self) -> None:
        super().start()
        self._ready_flag = False
        with self._transport_lifecycle_lock:
            if self._transport_stop_requested.is_set():
                return
            dispatcher = self._dispatcher
            if dispatcher is None:
                raise RuntimeError("official SDK channel did not initialize its event dispatcher")
            ws_client = _PerClientSDKWSClient(
                credentials=self._dify_credentials,
                domain=self._config.domain,
                event_handler=dispatcher,
            )
            self._ws_client = ws_client
        ws_client.start()

    @override
    def stop(self, *, join_timeout: float = 5.0) -> None:
        self._transport_stop_requested.set()
        with self._transport_lifecycle_lock:
            ws_client = self._ws_client
            if isinstance(ws_client, _PerClientSDKWSClient):
                self._ws_client = None
        close_error: Exception | None = None
        if isinstance(ws_client, _PerClientSDKWSClient):
            try:
                ws_client.stop()
            except Exception as exc:
                close_error = exc
        super().stop(join_timeout=join_timeout)
        if close_error is not None:
            raise close_error

    def _install_wire_ack_hook(self, ws_client: object) -> None:
        if not isinstance(ws_client, _SDKWireWriter):
            raise RuntimeError("official SDK WebSocket client does not expose the expected write seam")
        original_write = ws_client._write_message

        async def write_message(data: bytes) -> None:
            delivery = self._current_wire_ack.get()
            try:
                await original_write(data)
            finally:
                if delivery is not None:
                    with self._wire_ack_condition:
                        self._pending_wire_acks.discard(delivery)
                        delivery.set()
                        self._wire_ack_condition.notify_all()
                    self._current_wire_ack.set(None)

        ws_client._write_message = write_message
        self._wire_ack_hook_installed.set()

    def wait_for_pending_wire_acks(self) -> None:
        with self._wire_ack_condition:
            while self._pending_wire_acks:
                self._wire_ack_condition.wait()

    @override
    def _build_dispatcher(self):
        builder = lark.EventDispatcherHandler.builder(
            self._dify_credentials.encrypt_key or "",
            self._dify_credentials.verification_token or "",
            lark.LogLevel.ERROR,
        )
        return (
            builder.register_p2_im_message_receive_v1(self._on_message)
            .register_p2_card_action_trigger(self._on_card_action)
            .build()
        )

    def _on_message(self, event: P2ImMessageReceiveV1) -> None:
        self._dispatch(event)

    def _on_card_action(self, event: P2CardActionTrigger) -> P2CardActionTriggerResponse:
        self._dispatch(event)
        return P2CardActionTriggerResponse({})

    def _dispatch(self, event: P2CardActionTrigger | P2ImMessageReceiveV1) -> None:
        if self._wire_ack_tracking_enabled:
            self._wire_ack_hook_installed.wait()
            delivery = threading.Event()
            with self._wire_ack_condition:
                self._pending_wire_acks.add(delivery)
            self._current_wire_ack.set(delivery)

        acknowledged = False

        def acknowledge() -> None:
            nonlocal acknowledged
            acknowledged = True

        self._dify_callback(_sdk_event_envelope(event), acknowledge)
        if not acknowledged:
            raise RuntimeError("event responsibility was not accepted")


class _OfficialSDKStreamClient:
    def __init__(
        self,
        credentials: _FeishuLarkIMIntegrationCredentials,
        domain: str,
        callback: _StreamDeliveryCallback,
    ) -> None:
        self._channel = _SynchronousEventChannel(
            credentials=credentials,
            domain=domain,
            callback=callback,
        )
        self._loop = asyncio.new_event_loop()
        self._loop_ready = threading.Event()
        self._loop_thread: threading.Thread | None = None
        self._lifecycle_lock = threading.Lock()
        self._connect_future: Future[None] | None = None
        self._stopped = False

    def start(self) -> None:
        with self._lifecycle_lock:
            if self._stopped:
                raise RuntimeError("official SDK stream client was stopped before startup completed")
            if self._loop_thread is None:
                self._loop_thread = threading.Thread(
                    target=self._run_loop,
                    name="feishu-lark-sdk-stream",
                    daemon=True,
                )
                self._loop_thread.start()

        self._loop_ready.wait()
        with self._lifecycle_lock:
            if self._stopped:
                raise RuntimeError("official SDK stream client was stopped before startup completed")
            future = asyncio.run_coroutine_threadsafe(
                self._channel.connect_until_ready(timeout=_STREAM_READY_TIMEOUT_SECONDS),
                self._loop,
            )
            self._connect_future = future
        future.result()

    def stop(self) -> None:
        with self._lifecycle_lock:
            if self._stopped:
                return
            self._stopped = True
            loop_thread = self._loop_thread
            connect_future = self._connect_future

        try:
            self._channel.wait_for_pending_wire_acks()
        finally:
            try:
                self._channel.stop()
            finally:
                if connect_future is not None and not connect_future.done():
                    connect_future.cancel()
                if loop_thread is None:
                    self._loop.close()
                else:
                    self._loop.call_soon_threadsafe(self._loop.stop)
                    if loop_thread is not threading.current_thread():
                        loop_thread.join()

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._loop_ready.set()
        try:
            self._loop.run_forever()
        finally:
            self._loop.run_until_complete(self._loop.shutdown_asyncgens())
            self._loop.run_until_complete(self._loop.shutdown_default_executor())
            self._loop.close()


def _create_sdk_stream_client(
    credentials: _FeishuLarkIMIntegrationCredentials,
    domain: str,
    callback: _StreamDeliveryCallback,
) -> _OfficialSDKStreamClient:
    return _OfficialSDKStreamClient(credentials, domain, callback)


class _ExternalResponseModel(BaseModel):
    model_config = ConfigDict(extra="ignore", hide_input_in_errors=True, strict=True)


class _Tenant(_ExternalResponseModel):
    tenant_key: str | None = Field(default=None, min_length=1)


class _TenantData(_ExternalResponseModel):
    tenant: _Tenant


class _TenantResponse(_ExternalResponseModel):
    code: int
    data: _TenantData | None = None


class _ScopeData(_ExternalResponseModel):
    department_ids: list[str] = Field(default_factory=list)
    user_ids: list[str] = Field(default_factory=list)
    has_more: bool = Field(strict=True)
    page_token: str | None = Field(default=None, strict=True)


class _ScopeResponse(_ExternalResponseModel):
    code: int
    data: _ScopeData | None = None


class _DirectoryUser(_ExternalResponseModel):
    union_id: str = Field(min_length=1)
    name: str | None = None
    email: str | None = None
    enterprise_email: str | None = None


class _DirectoryDepartment(_ExternalResponseModel):
    department_id: str | None = None
    open_department_id: str | None = None


class _UserPageData(_ExternalResponseModel):
    items: list[_DirectoryUser] = Field(default_factory=list)
    has_more: bool = Field(strict=True)
    page_token: str | None = Field(default=None, strict=True)


class _UserPageResponse(_ExternalResponseModel):
    code: int
    data: _UserPageData | None = None


class _DepartmentPageData(_ExternalResponseModel):
    items: list[_DirectoryDepartment] = Field(default_factory=list)
    has_more: bool = Field(strict=True)
    page_token: str | None = Field(default=None, strict=True)


class _DepartmentPageResponse(_ExternalResponseModel):
    code: int
    data: _DepartmentPageData | None = None


class _MessageData(_ExternalResponseModel):
    message_id: str = Field(min_length=1)


class _MessageResponse(_ExternalResponseModel):
    code: int
    data: _MessageData | None = None


class _PatchResponse(_ExternalResponseModel):
    code: int


class _EncryptedWebhookEnvelope(_ExternalResponseModel):
    encrypt: str = Field(min_length=1)


class _WebhookChallenge(_ExternalResponseModel):
    type: Literal["url_verification"]
    token: str | None = None
    challenge: str


class _WebhookEventHeader(_ExternalResponseModel):
    token: str | None = None
    tenant_key: str = Field(min_length=1)
    event_id: str | None = None
    event_type: str | None = None
    create_time: str | None = None


class _WebhookEventEnvelope(_ExternalResponseModel):
    schema_version: str = Field(alias="schema")
    header: _WebhookEventHeader


_FEISHU_LARK_DIFY_ACTION_MARKER = "__dify.human_input.action"


@dataclass(frozen=True, slots=True)
class _MSFeishuLarkCardCodec(IMCardEventDecoder):
    """Own the credential-free Feishu/Lark card wire contract."""

    _FORM_NAME = "__dify.human_input"
    _CALLBACK_EVENT_TYPE = "card.action.trigger"
    _CALLBACK_SCHEMA_VERSION = 1
    _MAX_CARD_SIZE_BYTES = 30 * 1024
    _SUPPORTED_PROVIDERS = frozenset((IMProvider.FEISHU, IMProvider.LARK))
    _SUPPORTED_ACTION_STYLES = frozenset((ButtonStyle.DEFAULT, ButtonStyle.PRIMARY, ButtonStyle.ACCENT))
    _ACTION_MARKER = _FEISHU_LARK_DIFY_ACTION_MARKER
    _JSON_OBJECT_ADAPTER: ClassVar[TypeAdapter[dict[str, JsonValue]]] = TypeAdapter(
        dict[str, JsonValue],
        config=ConfigDict(strict=True, allow_inf_nan=False),
    )

    class _CallbackModel(BaseModel):
        model_config = ConfigDict(
            allow_inf_nan=False,
            extra="ignore",
            frozen=True,
            hide_input_in_errors=True,
            strict=True,
        )

    class _CallbackHeader(_CallbackModel):
        event_type: Literal["card.action.trigger"]

    class _CallbackOperator(_CallbackModel):
        union_id: str = Field(min_length=1)

        @field_validator("union_id")
        @classmethod
        def _require_non_blank_union_id(cls, value: str) -> str:
            if not value.strip():
                raise ValueError("Feishu/Lark callback union identifier is empty.")
            return value

    class _ButtonMetadata(BaseModel):
        model_config = ConfigDict(
            extra="forbid",
            frozen=True,
            hide_input_in_errors=True,
            strict=True,
        )

        version: Literal[1]
        action_id: str = Field(min_length=1)
        correlation_token: str

        @field_validator("action_id")
        @classmethod
        def _require_non_blank_action_id(cls, value: str) -> str:
            if not value.strip():
                raise ValueError("Feishu/Lark callback action identifier is empty.")
            return value

    class _ButtonValue(BaseModel):
        model_config = ConfigDict(
            extra="forbid",
            frozen=True,
            hide_input_in_errors=True,
            strict=True,
        )

        # Mypy requires a literal alias for Pydantic's dataclass transform.
        dify_action: _MSFeishuLarkCardCodec._ButtonMetadata = Field(alias="__dify.human_input.action")

    class _CallbackAction(_CallbackModel):
        tag: Literal["button"]
        name: str = Field(min_length=1)
        value: _MSFeishuLarkCardCodec._ButtonValue
        form_value: dict[str, JsonValue]

        @field_validator("name")
        @classmethod
        def _require_non_blank_action_name(cls, value: str) -> str:
            if not value.strip():
                raise ValueError("Feishu/Lark callback action name is empty.")
            return value

    class _CallbackEvent(_CallbackModel):
        operator: _MSFeishuLarkCardCodec._CallbackOperator
        action: _MSFeishuLarkCardCodec._CallbackAction

    class _SubmissionCallback(_CallbackModel):
        schema_version: Literal["2.0"] = Field(alias="schema")
        header: _MSFeishuLarkCardCodec._CallbackHeader
        event: _MSFeishuLarkCardCodec._CallbackEvent

    def assess(self, intent: ResolvedForm) -> CardAssessment:
        reason = self._unrepresentable_reason(intent)
        if reason is not None:
            return CardAssessment(False, reason)
        return CardAssessment(True)

    def encode(
        self,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> Mapping[str, JsonValue]:
        reason = self._unrepresentable_reason(intent)
        if reason is not None:
            raise DynamicCardMessagingError(reason)
        card = self._render_card(intent, correlation_token)
        if self._serialized_card_size(card) > self._MAX_CARD_SIZE_BYTES:
            raise DynamicCardMessagingError("Feishu/Lark cannot preserve a card beyond the Provider payload limit.")
        return card

    @override
    def decode(self, event: AuthenticatedIMEvent) -> IMCardEventDecodeResult:
        if event.provider not in self._SUPPORTED_PROVIDERS or event.event_type != self._CALLBACK_EVENT_TYPE:
            return UnrecognizedIMEvent()

        transport_envelope = self._decode_json_object(event.payload)
        if transport_envelope is None:
            raise IMCardEventDecodingError("Feishu/Lark card event payload is invalid.")
        serialized_callback = self._unwrap_transport_envelope(transport_envelope)
        if serialized_callback is None:
            raise IMCardEventDecodingError("Feishu/Lark card event envelope is invalid.")
        callback = self._decode_json_object(serialized_callback)
        if callback is None:
            raise IMCardEventDecodingError("Feishu/Lark card event payload is invalid.")
        action_value = self._recognition_action_value(callback)
        if action_value is None:
            raise IMCardEventDecodingError("Feishu/Lark card event schema is invalid.")
        if self._ACTION_MARKER not in action_value:
            return UnrecognizedIMEvent()

        submission = self._validate_submission(callback)
        if submission is None:
            raise IMCardEventDecodingError("Feishu/Lark card event schema is invalid.")
        metadata = submission.event.action.value.dify_action
        if submission.event.action.name != metadata.action_id:
            raise IMCardEventDecodingError("Feishu/Lark card event schema is invalid.")
        return IMCardEvent(
            provider_user_id=ProviderUserId(submission.event.operator.union_id),
            action_id=metadata.action_id,
            inputs=submission.event.action.form_value,
            correlation_token=CorrelationToken(metadata.correlation_token),
        )

    @classmethod
    def _decode_json_object(cls, serialized_callback: str) -> dict[str, JsonValue] | None:
        try:
            decoded_callback: JsonValue = json.loads(
                serialized_callback,
                parse_constant=cls._reject_non_standard_json_constant,
            )
        except (json.JSONDecodeError, ValueError, RecursionError):
            return None
        try:
            return cls._JSON_OBJECT_ADAPTER.validate_python(decoded_callback, strict=True)
        except ValidationError:
            return None

    @classmethod
    def _unwrap_transport_envelope(cls, envelope: dict[str, JsonValue]) -> str | None:
        if set(envelope) == {_AUTHENTICATED_WEBHOOK_PAYLOAD_KEY}:
            webhook = envelope[_AUTHENTICATED_WEBHOOK_PAYLOAD_KEY]
            if not isinstance(webhook, dict) or set(webhook) != {"encrypted", "native_payload"}:
                return None
            encrypted = webhook["encrypted"]
            native_payload = webhook["native_payload"]
            if not isinstance(encrypted, bool) or not isinstance(native_payload, str):
                return None
            return native_payload
        if set(envelope) == {_AUTHENTICATED_STREAM_PAYLOAD_KEY}:
            stream = envelope[_AUTHENTICATED_STREAM_PAYLOAD_KEY]
            if not isinstance(stream, dict) or set(stream) != {"native_payload", "object_type"}:
                return None
            native_payload = stream["native_payload"]
            object_type = stream["object_type"]
            if not isinstance(native_payload, str) or object_type != _CARD_ACTION_TRIGGER_OBJECT_TYPE:
                return None
            return native_payload
        return None

    @classmethod
    def _recognition_action_value(cls, callback: dict[str, JsonValue]) -> dict[str, JsonValue] | None:
        if callback.get("schema") != "2.0":
            return None
        header = callback.get("header")
        callback_event = callback.get("event")
        if not isinstance(header, dict) or header.get("event_type") != cls._CALLBACK_EVENT_TYPE:
            return None
        if not isinstance(callback_event, dict):
            return None
        action = callback_event.get("action")
        if not isinstance(action, dict):
            return None
        action_value = action.get("value")
        if not isinstance(action_value, dict):
            return {}
        return action_value

    @classmethod
    def _validate_submission(cls, callback: dict[str, JsonValue]) -> _SubmissionCallback | None:
        try:
            return cls._SubmissionCallback.model_validate(callback)
        except ValidationError:
            return None

    @classmethod
    def _unrepresentable_reason(cls, intent: ResolvedForm) -> str | None:
        if not intent.blocks and not intent.user_actions:
            return "Feishu/Lark cannot preserve an empty card."

        input_names: set[str] = set()
        for block in intent.blocks:
            match block:
                case MarkdownText(text=text):
                    if not text:
                        return "Feishu/Lark cannot preserve an empty Markdown block."
                    continue
                case FileInput() | FileListInput():
                    return "Feishu/Lark cards cannot represent file inputs."
                case ParagraphInput(output_variable_name=input_name):
                    pass
                case SelectInput(output_variable_name=input_name, options=options, default_value=default_value):
                    if not options or any(not option for option in options):
                        return "Feishu/Lark cannot preserve one select option."
                    if len(options) != len(set(options)):
                        return "Feishu/Lark cannot preserve duplicate select options."
                    if default_value is not None and default_value not in options:
                        return "Feishu/Lark cannot preserve one select input default."
            if input_name in input_names:
                return "Feishu/Lark cannot preserve duplicate card input identifiers."
            input_names.add(input_name)

        if any(action.button_style not in cls._SUPPORTED_ACTION_STYLES for action in intent.user_actions):
            return "Feishu/Lark cannot preserve one card action style."
        assessment_card = cls._render_card(intent, CorrelationToken(""))
        if cls._serialized_card_size(assessment_card) > cls._MAX_CARD_SIZE_BYTES:
            return "Feishu/Lark cannot preserve a card beyond the Provider payload limit."
        return None

    @classmethod
    def _render_card(
        cls,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> dict[str, JsonValue]:
        rendered_elements: list[JsonValue] = []
        for block in intent.blocks:
            if isinstance(block, MarkdownText):
                rendered_elements.append({"tag": "markdown", "content": block.text})
                continue
            placeholder: dict[str, JsonValue] = {
                "tag": "plain_text",
                "content": block.output_variable_name,
            }
            if isinstance(block, ParagraphInput):
                input_element: dict[str, JsonValue] = {
                    "tag": "input",
                    "name": block.output_variable_name,
                    "input_type": "multiline_text",
                    "width": "fill",
                    "required": True,
                    "label": placeholder,
                    "placeholder": placeholder,
                }
                if block.default_value is not None:
                    input_element["default_value"] = block.default_value
                rendered_elements.append(input_element)
                continue
            if isinstance(block, SelectInput):
                select_element: dict[str, JsonValue] = {
                    "tag": "select_static",
                    "name": block.output_variable_name,
                    "required": True,
                    "placeholder": placeholder,
                    "options": [
                        {
                            "text": {"tag": "plain_text", "content": option},
                            "value": option,
                        }
                        for option in block.options
                    ],
                }
                if block.default_value is not None:
                    select_element["initial_option"] = block.default_value
                rendered_elements.append(select_element)
                continue
            raise DynamicCardMessagingError("Feishu/Lark cards cannot represent file inputs.")

        if intent.user_actions:
            columns: list[JsonValue] = []
            for action in intent.user_actions:
                if action.button_style is ButtonStyle.PRIMARY:
                    button_type = "primary_filled"
                elif action.button_style is ButtonStyle.ACCENT:
                    button_type = "danger_filled"
                else:
                    button_type = "default"
                columns.append(
                    {
                        "tag": "column",
                        "width": "auto",
                        "elements": [
                            {
                                "tag": "button",
                                "name": action.id,
                                "type": button_type,
                                "text": {"tag": "plain_text", "content": action.title},
                                "form_action_type": "submit",
                                "behaviors": [
                                    {
                                        "type": "callback",
                                        "value": {
                                            cls._ACTION_MARKER: {
                                                "version": cls._CALLBACK_SCHEMA_VERSION,
                                                "action_id": action.id,
                                                "correlation_token": str(correlation_token),
                                            }
                                        },
                                    }
                                ],
                            }
                        ],
                    }
                )
            rendered_elements.append(
                {
                    "tag": "column_set",
                    "flex_mode": "none",
                    "horizontal_spacing": "8px",
                    "horizontal_align": "left",
                    "columns": columns,
                }
            )

        requires_form = any(not isinstance(block, MarkdownText) for block in intent.blocks) or bool(intent.user_actions)
        body_elements: list[JsonValue]
        if requires_form:
            body_elements = [{"tag": "form", "name": cls._FORM_NAME, "elements": rendered_elements}]
        else:
            body_elements = rendered_elements
        card: dict[str, JsonValue] = {
            "schema": "2.0",
            "config": {"update_multi": True},
            "body": {"direction": "vertical", "elements": body_elements},
        }
        if intent.title is not None:
            card["header"] = {"title": {"tag": "plain_text", "content": intent.title}}
        return card

    @staticmethod
    def _serialized_card_size(card: Mapping[str, JsonValue]) -> int:
        serialized_card = json.dumps(
            card,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
        return len(serialized_card.encode())

    @staticmethod
    def _reject_non_standard_json_constant(_serialized_constant: str) -> Never:
        raise ValueError("non-standard JSON constant")


_MS_FEISHU_LARK_CARD_CODEC = _MSFeishuLarkCardCodec()


class _ReferencePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)

    version: Literal[1]
    provider: IMProvider
    provider_tenant_id: str = Field(min_length=1)
    message_kind: Literal["text", "dynamic_card"]
    message_id: str = Field(min_length=1)


@dataclass(frozen=True, slots=True)
class _FeishuLarkMessageReference(MessageReference):
    opaque: str = field(repr=False)


class _FeishuLarkDirectory(IMDirectory):
    def __init__(self, gateway: _SDKGateway, provider: IMProvider) -> None:
        self._gateway = gateway
        self._provider = provider

    @override
    def read_directory(self) -> Directory | DirectoryReadFailure:
        try:
            return self._read_complete_directory()
        except Exception:
            _log_safe_error("Feishu/Lark directory read failed", extra={"im_provider": self._provider.value})
            return DirectoryReadFailure(f"{_provider_name(self._provider)} directory could not be read completely.")

    def _read_complete_directory(self) -> Directory:
        entries: list[DirectoryEntry] = []
        seen_users: set[str] = set()
        seen_departments = {_ROOT_DEPARTMENT}
        pending_departments = deque((_ROOT_DEPARTMENT,))

        while pending_departments:
            department = pending_departments.popleft()
            for user in self._read_users(department):
                if user.union_id in seen_users:
                    continue
                seen_users.add(user.union_id)
                entries.append(self._entry_from_user(user))
            for child in self._read_child_departments(department):
                if child in seen_departments:
                    continue
                seen_departments.add(child)
                pending_departments.append(child)
        return Directory(tuple(entries))

    @staticmethod
    def _entry_from_user(user: _DirectoryUser) -> DirectoryEntry:
        email = _optional_string(user.enterprise_email) or _optional_string(user.email)
        return DirectoryEntry(
            provider_user_id=ProviderUserId(user.union_id),
            display_name=_optional_string(user.name),
            email=email,
        )

    def _read_users(self, department: _DepartmentIdentity) -> tuple[_DirectoryUser, ...]:
        users: list[_DirectoryUser] = []
        page_token: str | None = None
        seen_tokens: set[str] = set()
        while True:
            response = _UserPageResponse.model_validate(self._gateway.list_users(department, page_token))
            if response.code != 0 or response.data is None:
                raise ValueError("directory user page was rejected")
            users.extend(response.data.items)
            page_token = _next_page_token(response.data.has_more, response.data.page_token, seen_tokens)
            if page_token is None:
                return tuple(users)

    def _read_child_departments(self, parent_department: _DepartmentIdentity) -> tuple[_DepartmentIdentity, ...]:
        department_ids: list[_DepartmentIdentity] = []
        page_token: str | None = None
        seen_tokens: set[str] = set()
        while True:
            response = _DepartmentPageResponse.model_validate(
                self._gateway.list_departments(parent_department, page_token)
            )
            if response.code != 0 or response.data is None:
                raise ValueError("directory department page was rejected")
            for child_department in response.data.items:
                child = _department_identity(child_department)
                if child is None:
                    raise ValueError("directory department identity is unavailable")
                department_ids.append(child)
            page_token = _next_page_token(response.data.has_more, response.data.page_token, seen_tokens)
            if page_token is None:
                return tuple(department_ids)


class _FeishuLarkMessaging(IMMessaging):
    def __init__(
        self,
        gateway: _SDKGateway,
        credentials: _FeishuLarkIMIntegrationCredentials,
        provider: IMProvider,
    ) -> None:
        self._gateway = gateway
        self._credentials = credentials
        self._provider = provider

    @override
    def send_text(self, provider_user_id: ProviderUserId, body: str) -> MessageSendingResult:
        try:
            signing_secret = _reference_signing_secret()
            plain_text = _commonmark_plain_text(body)
            content = json.dumps({"text": plain_text}, ensure_ascii=False, separators=(",", ":"))
            provider_tenant_id = _query_tenant_id(self._gateway)
            response = _MessageResponse.model_validate(
                self._gateway.create_message(str(provider_user_id), "text", content)
            )
        except Exception:
            _log_safe_error(
                "Feishu/Lark text message acceptance is unknown", extra={"im_provider": self._provider.value}
            )
            return MessageSendingError(f"{_provider_name(self._provider)} message acceptance could not be confirmed.")
        if response.code != 0 or response.data is None:
            return MessageSendingError(f"{_provider_name(self._provider)} message acceptance could not be confirmed.")
        return MessageAccepted(
            _encode_reference(
                provider=self._provider,
                provider_tenant_id=provider_tenant_id,
                message_kind=_REFERENCE_KIND_TEXT,
                message_id=response.data.message_id,
                signing_secret=signing_secret,
            )
        )


class _FeishuLarkDynamicCardMessaging(IMDynamicCardMessaging):
    def __init__(
        self,
        gateway: _SDKGateway,
        credentials: _FeishuLarkIMIntegrationCredentials,
        provider: IMProvider,
    ) -> None:
        self._gateway = gateway
        self._credentials = credentials
        self._provider = provider

    @override
    def assess(self, intent: ResolvedForm) -> CardAssessment:
        return _MS_FEISHU_LARK_CARD_CODEC.assess(intent)

    @override
    def send_card(
        self,
        provider_user_id: ProviderUserId,
        intent: ResolvedForm,
        correlation_token: CorrelationToken,
    ) -> MessageSendingResult:
        encoded_card = _MS_FEISHU_LARK_CARD_CODEC.encode(intent, correlation_token)
        content = json.dumps(encoded_card, ensure_ascii=False, separators=(",", ":"))
        failure = MessageSendingError(f"{_provider_name(self._provider)} card acceptance could not be confirmed.")
        try:
            signing_secret = _reference_signing_secret()
        except ValueError:
            _log_safe_error(
                "Feishu/Lark card acceptance failed at reference-signing stage",
                extra={"im_provider": self._provider.value},
            )
            return failure
        try:
            provider_tenant_id = _query_tenant_id(self._gateway)
        except Exception:
            _log_safe_error(
                "Feishu/Lark card acceptance failed at tenant-resolution stage",
                extra={"im_provider": self._provider.value},
            )
            return failure
        try:
            provider_response = self._gateway.create_message(str(provider_user_id), "interactive", content)
        except Exception:
            _log_safe_error(
                "Feishu/Lark card acceptance failed at create-message stage",
                extra={"im_provider": self._provider.value},
            )
            return failure
        try:
            response = _MessageResponse.model_validate(provider_response)
        except ValidationError:
            _log_safe_error(
                "Feishu/Lark card acceptance failed at response-validation stage",
                extra={"im_provider": self._provider.value},
            )
            return failure
        if response.code != 0:
            _log_safe_error(
                "Feishu/Lark card acceptance failed at provider-response stage",
                extra={"im_provider": self._provider.value},
            )
            return failure
        if response.data is None:
            _log_safe_error(
                "Feishu/Lark card acceptance failed at response-validation stage",
                extra={"im_provider": self._provider.value},
            )
            return failure
        return MessageAccepted(
            _encode_reference(
                provider=self._provider,
                provider_tenant_id=provider_tenant_id,
                message_kind=_REFERENCE_KIND_DYNAMIC_CARD,
                message_id=response.data.message_id,
                signing_secret=signing_secret,
            )
        )

    @override
    def replace_with_static(
        self,
        reference: MessageReference,
        intent: StaticCardIntent,
    ) -> ReplacementError | None:
        try:
            signing_secret = _reference_signing_secret()
        except ValueError:
            return ReplacementError(
                ReplacementErrorKind.UNKNOWN,
                f"{_provider_name(self._provider)} replacement acceptance is unknown.",
            )
        locator = _decode_reference(reference, signing_secret)
        if (
            locator is None
            or locator.provider is not self._provider
            or locator.message_kind != _REFERENCE_KIND_DYNAMIC_CARD
        ):
            return ReplacementError(
                ReplacementErrorKind.INVALID_REFERENCE,
                f"The {_provider_name(self._provider)} message reference is invalid.",
            )
        try:
            provider_tenant_id = _query_tenant_id(self._gateway)
        except Exception:
            return ReplacementError(
                ReplacementErrorKind.UNKNOWN,
                f"{_provider_name(self._provider)} replacement acceptance is unknown.",
            )
        if provider_tenant_id != locator.provider_tenant_id:
            return ReplacementError(
                ReplacementErrorKind.INVALID_REFERENCE,
                f"The {_provider_name(self._provider)} message reference is invalid.",
            )
        static_card = {
            "schema": "2.0",
            "body": {"elements": [{"tag": "markdown", "content": intent.rendered_content}]},
        }
        content = json.dumps(static_card, ensure_ascii=False, separators=(",", ":"))
        try:
            response = _PatchResponse.model_validate(self._gateway.patch_message(locator.message_id, content))
        except Exception:
            _log_safe_error("Feishu/Lark card replacement is unknown", extra={"im_provider": self._provider.value})
            return ReplacementError(
                ReplacementErrorKind.UNKNOWN,
                f"{_provider_name(self._provider)} replacement acceptance is unknown.",
            )
        if response.code in _STALE_MESSAGE_CODES:
            return ReplacementError(
                ReplacementErrorKind.STALE_REFERENCE,
                f"The referenced {_provider_name(self._provider)} card is no longer replaceable.",
            )
        if response.code != 0:
            return ReplacementError(
                ReplacementErrorKind.UNKNOWN,
                f"{_provider_name(self._provider)} replacement acceptance is unknown.",
            )
        return None


class _FeishuLarkWebhookHandler(IMWebhookHandler):
    """Authenticated Webhook boundary safe for concurrent calls and replays."""

    def __init__(
        self,
        gateway: _SDKGateway,
        credentials: _FeishuLarkIMIntegrationCredentials,
        provider: IMProvider,
        consumer: IMEventConsumer,
    ) -> None:
        self._gateway = gateway
        self._verification_token = credentials.verification_token
        self._encrypt_key = credentials.encrypt_key
        self._provider = provider
        self._consumer = consumer
        self._replay_lock = threading.Lock()
        self._replay_claims: dict[bytes, float] = {}

    @override
    def handle(self, request: WebhookRequest) -> WebhookResponse:
        if request.method != "POST":
            return _webhook_response(405, {"code": 1})
        authenticated = self._authenticate_and_decode(request)
        if authenticated is None:
            return _webhook_response(401, {"code": 1})
        decoded, replay_identity, encrypted, native_payload = authenticated

        if decoded.get("type") == "url_verification":
            try:
                challenge = _WebhookChallenge.model_validate(decoded)
            except ValidationError:
                return _webhook_response(400, {"code": 1})
            if not self._challenge_is_authenticated(challenge.token, decrypted=encrypted):
                return _webhook_response(401, {"code": 1})
            return _webhook_response(200, {"challenge": challenge.challenge})

        try:
            envelope = _WebhookEventEnvelope.model_validate(decoded)
        except ValidationError:
            return _webhook_response(400, {"code": 1})
        if not self._verification_token_matches(envelope.header.token):
            return _webhook_response(401, {"code": 1})
        try:
            provider_tenant_id = _query_tenant_id(self._gateway)
        except Exception:
            _log_safe_error("Feishu/Lark Webhook tenant validation failed", extra={"im_provider": self._provider.value})
            return _webhook_response(503, {"code": 1})
        if provider_tenant_id != envelope.header.tenant_key:
            return _webhook_response(401, {"code": 1})
        serialized_payload = _authenticated_webhook_payload(native_payload, encrypted=encrypted)
        event = AuthenticatedIMEvent(
            provider=self._provider,
            provider_tenant_id=provider_tenant_id,
            event_id=_optional_string(envelope.header.event_id),
            event_type=_optional_string(envelope.header.event_type),
            occurred_at=_webhook_occurred_at(envelope.header.create_time),
            received_at=request.received_at,
            payload=serialized_payload,
        )
        if replay_identity is not None and not self._claim_delivery(replay_identity):
            return _webhook_response(409, {"code": 1})
        try:
            acceptance = self._consumer.accept(event)
        except Exception:
            _log_safe_error(
                "Feishu/Lark Webhook consumer failed",
                extra={"im_provider": self._provider.value, "provider_tenant_id": provider_tenant_id},
            )
            return _webhook_response(503, {"code": 1})
        if acceptance is not EventAcceptance.ACCEPTED:
            return _webhook_response(503, {"code": 1})
        return _webhook_response(200, {"code": 0})

    def _authenticate_and_decode(
        self,
        request: WebhookRequest,
    ) -> tuple[dict[str, object], bytes | None, bool, str] | None:
        # Authentication must parse Provider JSON for challenge, token, signature,
        # and tenant checks. The separate native string is never reconstructed;
        # it is persisted exactly so only the codec normalizes card callback facts.
        if self._verification_token is None and self._encrypt_key is None:
            return None
        try:
            outer = _decode_json_object(request.body)
            encrypted = outer.get("encrypt")
            if encrypted is None:
                native_payload = request.body.decode()
                decoded = outer
            else:
                if self._encrypt_key is None:
                    return None
                envelope = _EncryptedWebhookEnvelope.model_validate(outer)
                plaintext = _decrypt_webhook_payload(envelope.encrypt, self._encrypt_key)
                native_payload = plaintext.decode()
                decoded = _decode_json_object(plaintext)
        except (ValueError, ValidationError, UnicodeDecodeError, binascii.Error):
            return None
        # The official SDK authenticates URL verification with the body token and requires signatures only for events.
        if decoded.get("type") == "url_verification":
            return decoded, None, encrypted is not None, native_payload
        replay_identity = None
        if self._encrypt_key is not None:
            replay_identity = _valid_webhook_signature(request, self._encrypt_key)
            if replay_identity is None:
                return None
        return decoded, replay_identity, encrypted is not None, native_payload

    def _claim_delivery(self, replay_identity: bytes) -> bool:
        now = time.monotonic()
        with self._replay_lock:
            expired = tuple(identity for identity, expires_at in self._replay_claims.items() if expires_at <= now)
            for identity in expired:
                del self._replay_claims[identity]
            if replay_identity in self._replay_claims:
                return False
            if len(self._replay_claims) >= _WEBHOOK_REPLAY_CACHE_CAPACITY:
                return False
            self._replay_claims[replay_identity] = now + _WEBHOOK_REPLAY_CLAIM_TTL_SECONDS
            return True

    def _verification_token_matches(self, token: str | None) -> bool:
        return self._verification_token is None or (
            token is not None and hmac.compare_digest(token, self._verification_token)
        )

    def _challenge_is_authenticated(self, token: str | None, *, decrypted: bool) -> bool:
        if self._verification_token is None:
            return decrypted
        return token is not None and hmac.compare_digest(token, self._verification_token)


class _FeishuLarkEventStream:
    """One-shot stream owning its callback gate, drain, ACK, and SDK client."""

    def __init__(
        self,
        *,
        credentials: _FeishuLarkIMIntegrationCredentials,
        provider: IMProvider,
        domain: str,
        consumer: IMEventConsumer,
    ) -> None:
        self._credentials = credentials
        self._provider = provider
        self._domain = domain
        self._consumer = consumer
        self._condition = threading.Condition()
        self._start_claimed = False
        self._start_in_progress = False
        self._state: Literal["idle", "starting", "running", "stopping", "stopped", "failed"] = "idle"
        self._accepting_callbacks = False
        self._in_flight_callbacks = 0
        self._client: _OfficialSDKStreamClient | None = None
        self._close_claimed = False
        self._close_done = False
        self._close_failed = False

    def start(self) -> None:
        with self._condition:
            if self._start_claimed:
                raise IMStreamStartError(
                    f"This {_provider_name(self._provider)} event stream has already been started."
                )
            self._start_claimed = True
            self._start_in_progress = True
            self._state = "starting"
            self._accepting_callbacks = True

        try:
            client = _create_sdk_stream_client(self._credentials, self._domain, self._handle_delivery)
            with self._condition:
                self._client = client
                self._condition.notify_all()
                if self._state != "starting":
                    raise RuntimeError("stream start was cancelled")
            client.start()
            with self._condition:
                if self._state != "starting":
                    raise RuntimeError("stream start was cancelled")
                self._state = "running"
                self._start_in_progress = False
                self._condition.notify_all()
            return
        except Exception:
            self._finish_failed_start()
            raise IMStreamStartError(
                f"The {_provider_name(self._provider)} event stream could not be started."
            ) from None

    def stop(self) -> None:
        with self._condition:
            if self._state == "stopped":
                self._raise_if_close_failed()
                return
            if self._state == "stopping":
                while self._state != "stopped":
                    self._condition.wait()
                self._raise_if_close_failed()
                return
            if self._state == "idle":
                self._start_claimed = True
            self._state = "stopping"
            self._accepting_callbacks = False
            while self._in_flight_callbacks:
                self._condition.wait()
            while self._client is None and self._start_in_progress:
                self._condition.wait()
            client = self._claim_client_close()

        if client is not None:
            self._close_client(client)
        with self._condition:
            # A failed start may own the close, so both terminal states must be
            # published before stop exposes the synchronous lifecycle boundary.
            while self._start_in_progress or not self._close_done:
                self._condition.wait()
            self._state = "stopped"
            self._condition.notify_all()
            self._raise_if_close_failed()

    def _finish_failed_start(self) -> None:
        with self._condition:
            self._accepting_callbacks = False
            if self._state != "stopping":
                self._state = "failed"
            while self._in_flight_callbacks:
                self._condition.wait()
            client = self._claim_client_close()
            self._start_in_progress = False
            self._condition.notify_all()
        if client is not None:
            self._close_client(client)
        else:
            with self._condition:
                while self._close_claimed and not self._close_done:
                    self._condition.wait()

    def _claim_client_close(self) -> _OfficialSDKStreamClient | None:
        if self._close_claimed or self._client is None:
            if self._client is None and not self._start_in_progress:
                self._close_done = True
                self._condition.notify_all()
            return None
        self._close_claimed = True
        return self._client

    def _close_client(self, client: _OfficialSDKStreamClient) -> None:
        close_failed = False
        try:
            client.stop()
        except Exception:
            close_failed = True
            _log_safe_error("Feishu/Lark stream close failed", extra={"im_provider": self._provider.value})
        finally:
            with self._condition:
                self._close_failed = close_failed
                self._close_done = True
                self._condition.notify_all()

    def _raise_if_close_failed(self) -> None:
        if self._close_failed:
            raise IMStreamStopError(f"The {_provider_name(self._provider)} event stream could not be stopped.")

    def _handle_delivery(self, sdk_event: _SDKEventEnvelope, acknowledge: Callable[[], None]) -> None:
        with self._condition:
            if not self._accepting_callbacks or self._state not in {"starting", "running"}:
                return
            self._in_flight_callbacks += 1
        try:
            if sdk_event.is_card_action:
                if sdk_event.object_type != _CARD_ACTION_TRIGGER_OBJECT_TYPE:
                    raise ValueError("SDK card event type is unsupported")
                serialized_payload = _authenticated_stream_payload(
                    sdk_event.native_payload,
                    object_type=sdk_event.object_type,
                )
            else:
                serialized_payload = sdk_event.native_payload
            event = AuthenticatedIMEvent(
                provider=self._provider,
                provider_tenant_id=sdk_event.provider_tenant_id,
                event_id=sdk_event.event_id,
                event_type=sdk_event.event_type,
                occurred_at=sdk_event.occurred_at,
                received_at=datetime.now(tz=UTC).replace(tzinfo=None),
                payload=serialized_payload,
            )
            acceptance = self._consumer.accept(event)
            if acceptance is EventAcceptance.ACCEPTED:
                acknowledge()
        except Exception:
            _log_safe_error("Feishu/Lark stream callback failed", extra={"im_provider": self._provider.value})
        finally:
            with self._condition:
                self._in_flight_callbacks -= 1
                self._condition.notify_all()


class _FeishuLarkIMProviderAdapter:
    """Externally serialized composition root shared by both wrappers."""

    def __init__(
        self,
        credentials: _FeishuLarkIMIntegrationCredentials,
        provider: IMProvider,
        domain: str,
    ) -> None:
        self._credentials = credentials
        self._provider = provider
        self._domain = domain
        self._gateway = _create_sdk_gateway(credentials, domain)
        self._directory = _FeishuLarkDirectory(self._gateway, provider)
        self._messaging = _FeishuLarkMessaging(self._gateway, credentials, provider)
        self._dynamic_card_messaging = _FeishuLarkDynamicCardMessaging(self._gateway, credentials, provider)
        self._closed = False

    @classmethod
    def card_event_decoder(cls) -> IMCardEventDecoder:
        return _MS_FEISHU_LARK_CARD_CODEC

    @property
    def provider(self) -> IMProvider:
        self._ensure_open()
        return self._provider

    def test_credentials(self) -> CredentialTestSuccess | CredentialTestFailure:
        self._ensure_open()
        try:
            tenant_response = _TenantResponse.model_validate(self._gateway.query_tenant())
        except Exception:
            _log_safe_error("Feishu/Lark credential test failed", extra={"im_provider": self._provider.value})
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                f"{_provider_name(self._provider)} credential testing could not be completed.",
            )
        if tenant_response.code != 0:
            kind = (
                CredentialTestFailureKind.AUTHENTICATION_REJECTED
                if tenant_response.code in _AUTHENTICATION_REJECTED_CODES
                else CredentialTestFailureKind.UNKNOWN
            )
            return CredentialTestFailure(kind, f"{_provider_name(self._provider)} rejected the credential test.")
        if tenant_response.data is None or tenant_response.data.tenant.tenant_key is None:
            return CredentialTestFailure(
                CredentialTestFailureKind.TENANT_ID_UNAVAILABLE,
                f"{_provider_name(self._provider)} did not provide a stable tenant identity.",
            )
        try:
            self._validate_complete_scope()
            self._validate_root_department_access()
        except Exception:
            return CredentialTestFailure(
                CredentialTestFailureKind.UNKNOWN,
                f"{_provider_name(self._provider)} baseline permissions could not be confirmed.",
            )
        return CredentialTestSuccess(self._provider, tenant_response.data.tenant.tenant_key)

    def _validate_complete_scope(self) -> None:
        page_token: str | None = None
        seen_tokens: set[str] = set()
        while True:
            response = _ScopeResponse.model_validate(self._gateway.list_scope(page_token))
            if response.code != 0 or response.data is None:
                raise ValueError("directory scope page was rejected")
            page_token = _next_page_token(response.data.has_more, response.data.page_token, seen_tokens)
            if page_token is None:
                return

    def _validate_root_department_access(self) -> None:
        response = _DepartmentPageResponse.model_validate(self._gateway.list_departments(_ROOT_DEPARTMENT, None))
        if response.code != 0 or response.data is None:
            raise ValueError("root department access was rejected")
        for department in response.data.items:
            if _department_identity(department) is None:
                raise ValueError("root department response contains an invalid identity")
        _next_page_token(response.data.has_more, response.data.page_token, set())

    @property
    def directory(self) -> IMDirectory:
        self._ensure_open()
        return self._directory

    @property
    def messaging(self) -> IMMessaging:
        self._ensure_open()
        return self._messaging

    @property
    def dynamic_card_messaging(self) -> IMDynamicCardMessaging:
        self._ensure_open()
        return self._dynamic_card_messaging

    def create_webhook_handler(self, consumer: IMEventConsumer) -> IMWebhookHandler:
        self._ensure_open()
        return _FeishuLarkWebhookHandler(
            _create_sdk_gateway(self._credentials, self._domain),
            self._credentials,
            self._provider,
            consumer,
        )

    def create_stream_handler(self, consumer: IMEventConsumer) -> _FeishuLarkEventStream:
        self._ensure_open()
        return _FeishuLarkEventStream(
            credentials=self._credentials,
            provider=self._provider,
            domain=self._domain,
            consumer=consumer,
        )

    def close(self) -> None:
        self._closed = True

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError(f"{_provider_name(self._provider)} adapter is closed")


class FeishuIMProviderAdapter(_FeishuLarkIMProviderAdapter):
    """Thin typed Feishu wrapper over the shared implementation."""

    def __init__(self, credentials: FeishuIMIntegrationCredentials) -> None:
        if not isinstance(credentials, FeishuIMIntegrationCredentials):
            raise TypeError("Feishu adapter requires resolved Feishu credentials")
        super().__init__(credentials, IMProvider.FEISHU, _FEISHU_DOMAIN)


class LarkIMProviderAdapter(_FeishuLarkIMProviderAdapter):
    """Thin typed Lark wrapper over the shared implementation."""

    def __init__(self, credentials: LarkIMIntegrationCredentials) -> None:
        if not isinstance(credentials, LarkIMIntegrationCredentials):
            raise TypeError("Lark adapter requires resolved Lark credentials")
        super().__init__(credentials, IMProvider.LARK, _LARK_DOMAIN)


def _query_tenant_id(gateway: _SDKGateway) -> str:
    response = _TenantResponse.model_validate(gateway.query_tenant())
    if response.code != 0 or response.data is None or response.data.tenant.tenant_key is None:
        raise ValueError("stable tenant identity is unavailable")
    return response.data.tenant.tenant_key


def _commonmark_plain_text(body: str) -> str:
    parts: list[str] = []
    for token in _COMMONMARK_PARSER.parse(body):
        if token.type == "inline":
            parts.extend(_commonmark_inline_plain_text(token.children or ()))
        elif token.type in {"code_block", "fence"}:
            parts.append(token.content)
        elif token.type in {"heading_close", "list_item_close"} or (
            token.type == "paragraph_close" and not token.hidden
        ):
            if parts and not parts[-1].endswith("\n"):
                parts.append("\n")
    return "".join(parts).rstrip("\n")


def _commonmark_inline_plain_text(tokens: Sequence[Token]) -> list[str]:
    parts: list[str] = []
    links: list[tuple[int, str | None]] = []
    for token in tokens:
        if token.type in {"text", "code_inline"}:
            parts.append(token.content)
        elif token.type in {"softbreak", "hardbreak"}:
            parts.append("\n")
        elif token.type == "image":
            parts.append(token.content)
        elif token.type == "link_open":
            href = token.attrGet("href")
            links.append((len(parts), href if isinstance(href, str) else None))
        elif token.type == "link_close" and links:
            label_start, href = links.pop()
            label = "".join(parts[label_start:])
            if href and href != label:
                parts.append(f" ({href})")
    return parts


def _valid_webhook_signature(request: WebhookRequest, encrypt_key: str) -> bytes | None:
    timestamps = _header_values(request.headers, "x-lark-request-timestamp")
    nonces = _header_values(request.headers, "x-lark-request-nonce")
    signatures = _header_values(request.headers, "x-lark-signature")
    if len(timestamps) != 1 or len(nonces) != 1 or len(signatures) != 1:
        return None
    # The Provider SDK treats timestamp and nonce as opaque signature material.
    # The verified digest is also the replay identity so ambiguous field boundaries
    # cannot produce multiple claims for the same authenticated signature material.
    signed = timestamps[0].encode() + nonces[0].encode() + encrypt_key.encode() + request.body
    digest = hashlib.sha256(signed).digest()
    if not hmac.compare_digest(signatures[0], digest.hex()):
        return None
    return digest


def _decrypt_webhook_payload(encrypted: str, encrypt_key: str) -> bytes:
    encrypted_bytes = base64.b64decode(encrypted, validate=True)
    block_size = algorithms.AES.block_size // 8
    if len(encrypted_bytes) < block_size * 2 or len(encrypted_bytes) % block_size:
        raise ValueError("invalid encrypted Webhook payload")
    iv = encrypted_bytes[:block_size]
    decryptor = Cipher(algorithms.AES(hashlib.sha256(encrypt_key.encode()).digest()), modes.CBC(iv)).decryptor()
    padded = decryptor.update(encrypted_bytes[block_size:]) + decryptor.finalize()
    unpadder = symmetric_padding.PKCS7(algorithms.AES.block_size).unpadder()
    return unpadder.update(padded) + unpadder.finalize()


def _decode_json_object(body: bytes) -> dict[str, object]:
    decoded = json.loads(body)
    if not isinstance(decoded, dict) or any(not isinstance(key, str) for key in decoded):
        raise ValueError("Webhook payload is not a JSON object")
    return decoded


def _webhook_occurred_at(create_time: str | None) -> datetime | None:
    if create_time is None:
        return None
    try:
        timestamp = int(create_time)
        if len(create_time) == _MICROSECOND_TIMESTAMP_DIGITS:
            units_per_second = _MICROSECONDS_PER_SECOND
        elif len(create_time) == _MILLISECOND_TIMESTAMP_DIGITS:
            units_per_second = _MILLISECONDS_PER_SECOND
        else:
            return None
        seconds, subsecond_units = divmod(timestamp, units_per_second)
        microseconds = subsecond_units * (_MICROSECONDS_PER_SECOND // units_per_second)
        return datetime.fromtimestamp(seconds, tz=UTC).replace(microsecond=microseconds, tzinfo=None)
    except (OSError, OverflowError, ValueError):
        return None


def _webhook_response(status_code: int, body: Mapping[str, object]) -> WebhookResponse:
    return WebhookResponse(
        status_code=status_code,
        headers=_JSON_RESPONSE_HEADERS,
        body=json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode(),
    )


def _header_values(headers: tuple[tuple[str, str], ...], target: str) -> tuple[str, ...]:
    return tuple(value for name, value in headers if name.casefold() == target)


def _next_page_token(has_more: bool, page_token: str | None, seen_tokens: set[str]) -> str | None:
    if not has_more:
        return None
    if page_token is None or not page_token.strip() or page_token in seen_tokens:
        raise ValueError("invalid pagination")
    seen_tokens.add(page_token)
    return page_token


def _optional_string(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value


def _department_identity(department: _DirectoryDepartment) -> _DepartmentIdentity | None:
    department_id = _optional_string(department.department_id)
    if department_id is not None:
        return _DepartmentIdentity(department_id, "department_id")
    open_department_id = _optional_string(department.open_department_id)
    if open_department_id is not None:
        return _DepartmentIdentity(open_department_id, "open_department_id")
    return None


def _encode_reference(
    *,
    provider: IMProvider,
    provider_tenant_id: str,
    message_kind: Literal["text", "dynamic_card"],
    message_id: str,
    signing_secret: str,
) -> _FeishuLarkMessageReference:
    reference_payload = _ReferencePayload(
        version=_REFERENCE_VERSION,
        provider=provider,
        provider_tenant_id=provider_tenant_id,
        message_kind=message_kind,
        message_id=message_id,
    )
    payload_bytes = reference_payload.model_dump_json().encode()
    signature = hmac.new(signing_secret.encode(), payload_bytes, hashlib.sha256).digest()
    opaque = f"{_urlsafe_encode(payload_bytes)}.{_urlsafe_encode(signature)}"
    return _FeishuLarkMessageReference(opaque)


def _reference_signing_secret() -> str:
    secret_key = dify_config.SECRET_KEY
    if not secret_key:
        raise ValueError("Dify reference signing key is unavailable")
    return hmac.new(secret_key.encode(), _REFERENCE_SIGNING_CONTEXT, hashlib.sha256).hexdigest()


def _decode_reference(reference: MessageReference, signing_secret: str) -> _ReferencePayload | None:
    if not isinstance(reference, _FeishuLarkMessageReference):
        return None
    try:
        payload_part, signature_part = reference.opaque.split(".", maxsplit=1)
        payload_bytes = _urlsafe_decode(payload_part)
        signature = _urlsafe_decode(signature_part)
        if _urlsafe_encode(payload_bytes) != payload_part or _urlsafe_encode(signature) != signature_part:
            return None
        if len(signature) != hashlib.sha256().digest_size:
            return None
        expected_signature = hmac.new(signing_secret.encode(), payload_bytes, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected_signature):
            return None
        return _ReferencePayload.model_validate_json(payload_bytes)
    except (ValueError, binascii.Error, ValidationError):
        return None


def _urlsafe_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _urlsafe_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.b64decode(value + padding, altchars=b"-_", validate=True)


def _sdk_response_mapping(response: object) -> Mapping[str, object]:
    serialized = lark.JSON.marshal(response)
    if serialized is None:
        raise ValueError("SDK response is empty")
    decoded = json.loads(serialized)
    if not isinstance(decoded, dict) or any(not isinstance(key, str) for key in decoded):
        raise ValueError("SDK response is not a JSON object")
    return decoded


def _sdk_event_mapping(event: object) -> Mapping[str, object]:
    serialized = lark.JSON.marshal(event)
    if serialized is None:
        raise ValueError("SDK event is empty")
    decoded = json.loads(serialized)
    if not isinstance(decoded, dict) or any(not isinstance(key, str) for key in decoded):
        raise ValueError("SDK event is not a JSON object")
    return decoded


def _sdk_event_envelope(event: P2CardActionTrigger | P2ImMessageReceiveV1) -> _SDKEventEnvelope:
    serialized = lark.JSON.marshal(event)
    if serialized is None:
        raise ValueError("SDK event is empty")
    header = event.header
    if header is None:
        raise ValueError("SDK event header is empty")
    provider_tenant_id = _optional_string(header.tenant_key)
    if provider_tenant_id is None:
        raise ValueError("SDK event tenant identifier is empty")
    is_card_action = isinstance(event, P2CardActionTrigger)
    if not is_card_action and not isinstance(event, P2ImMessageReceiveV1):
        raise ValueError("SDK event type is unsupported")
    object_type = f"{type(event).__module__}.{type(event).__qualname__}"
    if is_card_action and object_type != _CARD_ACTION_TRIGGER_OBJECT_TYPE:
        raise ValueError("SDK card event type is unsupported")
    return _SDKEventEnvelope(
        native_payload=serialized,
        object_type=object_type,
        provider_tenant_id=provider_tenant_id,
        event_id=_optional_string(header.event_id),
        event_type=_optional_string(header.event_type),
        occurred_at=_webhook_occurred_at(header.create_time),
        is_card_action=is_card_action,
    )


def _authenticated_webhook_payload(native_payload: str, *, encrypted: bool) -> str:
    # The wrapper persists transport provenance while leaving the authenticated
    # decrypted Provider JSON byte-for-byte unchanged for codec-owned parsing.
    return json.dumps(
        {
            _AUTHENTICATED_WEBHOOK_PAYLOAD_KEY: {
                "encrypted": encrypted,
                "native_payload": native_payload,
            }
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _authenticated_stream_payload(native_payload: str, *, object_type: str) -> str:
    # The SDK object type and exact marshal output are transport evidence; only
    # the codec may parse the nested callback into transport-neutral facts.
    return json.dumps(
        {
            _AUTHENTICATED_STREAM_PAYLOAD_KEY: {
                "native_payload": native_payload,
                "object_type": object_type,
            }
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _provider_name(provider: IMProvider) -> str:
    return "Feishu" if provider is IMProvider.FEISHU else "Lark"
