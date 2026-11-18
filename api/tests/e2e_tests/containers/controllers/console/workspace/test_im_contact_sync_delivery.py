"""HTTP sync commands must reach a real broker and the default worker queues."""

from collections.abc import Iterator
from threading import Thread
from time import monotonic, sleep

import pytest
from celery import Celery
from celery.contrib.testing.worker import start_worker
from flask import Flask, Response
from flask.testing import FlaskClient
from slack_sdk.http_retry import RetryHandler
from slack_sdk.web import WebClient
from sqlalchemy.orm import Session
from testcontainers.redis import RedisContainer
from werkzeug.serving import make_server

from core.human_input_v2.entities import IMProvider, IMSyncRunStatus
from core.human_input_v2.im_integration.adapters import SlackCredentials
from core.human_input_v2.im_integration.adapters import slack as slack_adapter
from core.human_input_v2.shared import AccountId, TenantId
from dify_app import DifyApp
from extensions.ext_celery import init_app as init_celery_app
from extensions.ext_key_provider import key_provider_manager
from libs.datetime_utils import naive_utc_now
from libs.rsa import generate_key_pair
from libs.uuid_utils import uuidv7
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId, IMChannelStatus, WebhookId
from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter
from services.human_input_v2.im_credential_codec import IMCredentialCodec
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher
from tests.e2e_tests.containers.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.worker_entrypoint import worker_configuration

_SYNC_RUNS_PATH = "/console/api/workspaces/current/human-input/v2/im-sync-runs"
_SLACK_DIRECTORY_RESPONSE = b"""{
  "ok": true,
  "members": [{
    "id": "U_QUEUE_REVIEWER",
    "profile": {
      "display_name_normalized": "Queue Worker Reviewer",
      "email": "queue-reviewer@example.com"
    }
  }],
  "response_metadata": {"next_cursor": ""}
}"""


@pytest.fixture
def _slack_directory(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Serve deterministic Slack HTTP responses while retaining the SDK and adapter."""
    app = Flask(__name__)

    @app.route("/api/users.list", methods=["GET", "POST"])
    def users_list() -> Response:
        return Response(_SLACK_DIRECTORY_RESPONSE, mimetype="application/json")

    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()

    def local_web_client(*, token: str, retry_handlers: list[RetryHandler]) -> WebClient:
        return WebClient(
            token=token,
            base_url=f"http://127.0.0.1:{server.server_port}/api/",
            proxy="",
            timeout=5,
            retry_handlers=retry_handlers,
        )

    # Only replace the external SDK endpoint; credential decoding and directory parsing stay real.
    monkeypatch.setattr(slack_adapter, "WebClient", local_web_client)
    try:
        yield
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


@pytest.fixture
def _default_im_worker(
    flask_app_with_containers: DifyApp,
    redis_container: RedisContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[None]:
    """Publish and consume on the supplied Redis, restoring the previous Celery app afterward."""
    selected = worker_configuration({})
    assert selected.returncode == 0, selected.stderr
    queues = selected.stdout.splitlines()[-1].split(",")
    previous_app = flask_app_with_containers.extensions["celery"]
    assert isinstance(previous_app, Celery)
    broker_url = f"redis://{redis_container.get_container_host_ip()}:{redis_container.get_exposed_port(6379)}/1"
    # Celery reads this environment variable before its configured broker URL.
    monkeypatch.setenv("CELERY_BROKER_URL", broker_url)

    with config_overrides_context(CELERY_BROKER_URL=broker_url, CELERY_USE_SENTINEL=False, CELERY_BACKEND="redis"):
        worker_app = init_celery_app(flask_app_with_containers)
        worker_app.conf.update(
            task_always_eager=False,
            broker_transport_options={"global_keyprefix": f"im-sync-worker-{uuidv7()}:"},
        )
        try:
            with start_worker(worker_app, queues=queues, pool="solo", perform_ping_check=False, shutdown_timeout=10):
                # Task imports during worker startup can change Celery's current app.
                worker_app.set_current()
                yield
        finally:
            flask_app_with_containers.extensions["celery"] = previous_app
            previous_app.set_default()
            previous_app.set_current()
            worker_app.close()


@pytest.mark.usefixtures("_slack_directory", "_default_im_worker")
def test_http_sync_is_consumed_by_default_worker_and_persists_results(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    tenant.encrypt_public_key = generate_key_pair(tenant.id)
    credentials = SlackCredentials(
        provider=IMProvider.SLACK,
        client_id="queue-test-client",
        client_secret="queue-test-secret",
        signing_secret="queue-test-signing-secret",
        bot_token="xoxb-queue-test",
    )
    protected = IMCredentialCodec(TenantBoundCredentialCipher(key_provider_manager.provider, tenant.id)).seal(
        credentials
    )
    now = naive_utc_now()
    channel = IMChannel(
        id=IMChannelId(str(uuidv7())),
        created_at=now,
        updated_at=now,
        provider=IMProvider.SLACK,
        provider_tenant_id="queue-test-workspace",
        encrypted_credentials=protected,
        app_identifier=credentials.client_id,
        webhook_id=WebhookId(uuidv7().hex),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )
    WorkspaceIMChannelWriter(db_session_with_containers, TenantId(tenant.id), AccountId(account.id)).create(channel)
    db_session_with_containers.commit()
    headers = authenticate_console_client(test_client_with_containers, account)

    created = test_client_with_containers.post(_SYNC_RUNS_PATH, headers=headers)
    assert created.status_code == 200
    created_payload = created.get_json()
    assert created_payload is not None
    run_id = created_payload["run"]["id"]

    deadline = monotonic() + 20
    latest = test_client_with_containers.get(f"{_SYNC_RUNS_PATH}/latest", headers=headers)
    assert latest.status_code == 200
    payload = latest.get_json()
    assert payload is not None
    while (
        payload["run"]["status"] in (IMSyncRunStatus.QUEUED.value, IMSyncRunStatus.RUNNING.value)
        and monotonic() < deadline
    ):
        sleep(0.05)
        latest = test_client_with_containers.get(f"{_SYNC_RUNS_PATH}/latest", headers=headers)
        assert latest.status_code == 200
        payload = latest.get_json()
        assert payload is not None

    assert payload["run"]["id"] == run_id
    assert payload["run"]["status"] == IMSyncRunStatus.SUCCEEDED.value, payload
    identities = test_client_with_containers.get(
        "/console/api/workspaces/current/human-input/v2/im-identities",
        query_string={"keyword": "Queue Worker Reviewer", "page": 1, "limit": 10},
        headers=headers,
    )
    assert identities.status_code == 200
    identity_payload = identities.get_json()
    assert identity_payload is not None
    assert identity_payload["total"] == 1
    assert identity_payload["data"][0]["provider_user_id"] == "U_QUEUE_REVIEWER"
