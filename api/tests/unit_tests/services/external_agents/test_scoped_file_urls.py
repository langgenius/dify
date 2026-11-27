"""Scoped URL issuance and real public byte delivery over SQL/native file storage."""

import base64
import hashlib
import hmac
from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import pytest
from flask import Flask
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from controllers.files import bp as files_blueprint
from extensions.ext_application_services import ApplicationServices
from extensions.ext_storage import Storage
from extensions.storage.opendal_storage import OpenDALStorage
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import Agent, AgentKind, AgentScope, AgentSource
from models.external_agent import ExternalAgentConnectionRevision, ExternalAgentFileLease, ExternalAgentHead
from providers.a2a.control_adapters import WorkspaceExternalAssetAccess
from providers.a2a.files import DifyFileAdapter
from providers.a2a.test_file_urls import DifyTestFileURLSigner
from providers.a2a.test_files import ExternalTestFileUpload
from providers.a2a.transport import BoundedTransport
from repositories.external_agents.file_lifecycle_repository import ExternalFileLifecycleRepository
from repositories.external_agents.test_file_access_repository import ExternalTestFileAccessRepository
from repositories.external_agents.test_file_repository import ExternalTestFileRepository
from repositories.upload_file_delivery_repository import UploadFileDeliveryQueryRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.external_agents.contracts import (
    ExternalAgentConflictError,
    ExternalAgentForbiddenError,
    ExternalAgentNotFoundError,
)
from services.external_agents.file_profile import FileLimits
from services.external_agents.invocation_agg import ExternalInvocationAgg
from services.external_agents.io_contracts import FileBlob, FileScope, JsonObject, OutputField
from services.external_agents.protocol import GatewayReceipt
from services.external_agents.runtime_contracts import ExecutionIdentity, InvocationDraft, RuntimeScope
from services.external_agents.test_file_access import ExternalTestFileAccessService
from services.external_agents.test_file_access import TestFileURL as ScopedURL
from services.external_agents.test_service import TestFile as InputFile
from services.file_service import FileService
from services.upload_file_delivery_service import UploadFileDeliveryService
from tests.helpers.unit.config_override import config_overrides_context
from tests.unit_tests.providers.a2a.test_files import FileEgress


@dataclass
class FileURLs:
    app: Flask
    client: FlaskClient
    sessions: sessionmaker[Session]
    services: ApplicationServices
    context: RequestContext
    agent_id: str
    access: ExternalTestFileAccessService
    clock: list[datetime]
    storage: Storage
    files: FileService

    def input(self, page: str = "page") -> InputFile:
        """Create real bytes and an owned committed input through actual adapters."""
        blob = FileBlob(filename="input.txt", media_type="text/plain", data=b"input owned bytes")
        adapter = ExternalTestFileUpload(
            files=self.files, remote=BoundedTransport(FileEgress(b"unused")), limits=FileLimits()
        )
        store = ExternalTestFileRepository(sessions=self.sessions, limits=FileLimits())
        plan = adapter.plan(self.context, blob)
        lease = store.register(self.context, agent_id=self.agent_id, page_session_id=page, plan=plan, blob=blob)
        adapter.upload(self.context, blob, reserved_file_id=plan.file_id)
        assert store.complete(self.context, lease_id=lease.lease_id)
        return lease

    def output(self, page: str = "page") -> tuple[str, JsonObject]:
        """Materialize protocol output with real IO; no successful service response is substituted."""
        repo = self.services.external_agents.repository
        scope = RuntimeScope(
            tenant_id=self.context.active_workspace_id,
            initiator_id=self.context.account_id,
            app_id=None,
            origin="overview_test",
        )
        value = repo.create(
            scope,
            InvocationDraft(
                invocation_id=str(uuid4()),
                agent_id=self.agent_id,
                message_id=str(uuid4()),
                identity=ExecutionIdentity(execution_id=str(uuid4()), node_id="overview-test", frame_id="root"),
                parts=({"text": "Test output"},),
                declared_outputs=(OutputField(name="report", kind="file"),),
                test_generation=1,
                job={"page_session_id": page, "input_lease_ids": []},
            ),
            now=self.clock[0],
        )
        admitted = repo.acquire_dispatch(scope, value.id, now=self.clock[0])
        assert admitted is not None
        sending = repo.begin_send(scope, admitted, now=self.clock[0])
        assert sending is not None
        adapter = DifyFileAdapter(
            sessions=self.sessions,
            storage=self.storage,
            files=self.files,
            lifecycle=ExternalFileLifecycleRepository(sessions=self.sessions),
            remote_transport=BoundedTransport(FileEgress(b"unused")),
        )
        part: JsonObject = {
            "raw": base64.b64encode(b"output owned bytes").decode(),
            "filename": "output.txt",
            "mediaType": "text/plain",
        }
        file = adapter.materialize(
            FileScope(tenant_id=scope.tenant_id, actor_id=scope.initiator_id, app_id=None, invocation_id=value.id),
            part,
            artifact_id="report",
            part_index=0,
        )
        transitioned = ExternalInvocationAgg(sending, self.services.external_agents.settings).receive(
            GatewayReceipt(
                kind="task", task_id=str(uuid4()), context_id="unit-context", state="TASK_STATE_COMPLETED", payload={}
            ),
            self.clock[0],
            outputs={"report": file.value},
        )
        assert repo.save(scope, sending, transitioned.invocation)
        return value.id, file.value

    def read(self, link: ScopedURL) -> tuple[int, bytes]:
        parsed = urlsplit(link.url)
        response = self.client.get(urlunsplit(("", "", parsed.path, parsed.query, "")))
        return response.status_code, response.data


@pytest.fixture
def urls(
    sqlite_session_factory: sessionmaker[Session],
    account_application_services: ApplicationServices,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[FileURLs]:
    """Bind real SQL/storage/public file controller and the canonical scoped-access service."""
    sessions = sqlite_session_factory
    storage = Storage()
    storage.storage_runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
    monkeypatch.setattr("services.file_service.storage", storage)
    monkeypatch.setattr("providers.a2a.test_files.storage", storage)
    with sessions.begin() as session:
        tenant, actor = Tenant(name="Scoped files"), Account(name="Owner", email="scoped-files@example.test")
        session.add_all((tenant, actor))
        session.flush()
        session.add(TenantAccountJoin(tenant_id=tenant.id, account_id=actor.id, role=TenantAccountRole.OWNER))
        agent = Agent(
            tenant_id=tenant.id,
            name="Scoped file agent",
            agent_kind=AgentKind.EXTERNAL_A2A,
            scope=AgentScope.ROSTER,
            source=AgentSource.ROSTER,
        )
        session.add(agent)
        session.flush()
        revision = str(uuid4())
        session.add(ExternalAgentHead(agent_id=agent.id, tenant_id=tenant.id, active_connection_revision_id=revision))
        session.add(
            ExternalAgentConnectionRevision(
                id=revision,
                tenant_id=tenant.id,
                agent_id=agent.id,
                endpoint="https://unused.example.test",
                interface_url="https://unused.example.test/a2a",
                auth_type="none",
                credential_ciphertext=None,
                agent_card={"name": "Scoped", "description": "Declared"},
                capabilities={},
                fingerprint="a" * 64,
                auth_check="not_exercised",
                created_by=actor.id,
                verified_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
        context, agent_id = RequestContext("files", None, actor.id, tenant.id), agent.id
    clock = [datetime.now(UTC)]
    with config_overrides_context(
        SECRET_KEY="scoped-file-unit-secret",
        FILES_URL="https://files.example.test",
        FILES_ACCESS_TIMEOUT=30,
        RBAC_ENABLED=False,
    ):
        access = ExternalTestFileAccessService(
            store=ExternalTestFileAccessRepository(sessions=sessions, clock=lambda: clock[0]),
            access=WorkspaceExternalAssetAccess(
                workspaces=WorkspaceRepository(sessions),
                permissions=account_application_services.rbac.members,
                rbac_enabled=False,
            ),
            signer=DifyTestFileURLSigner(
                secret_key=dify_config.SECRET_KEY,
                base_url=dify_config.FILES_URL,
                signature_ttl_seconds=dify_config.FILES_ACCESS_TIMEOUT,
                clock=lambda: clock[0],
            ),
        )
        service = replace(
            account_application_services,
            external_agents=replace(account_application_services.external_agents, test_file_access=access),
            upload_file_delivery=UploadFileDeliveryService(
                files=UploadFileDeliveryQueryRepository(session_factory=sessions), storage=storage, access=access
            ),
        )
        app = Flask(__name__)
        app.extensions["application_services"] = service
        app.register_blueprint(files_blueprint)
        yield FileURLs(
            app,
            app.test_client(),
            sessions,
            service,
            context,
            agent_id,
            access,
            clock,
            storage,
            FileService(session_factory=sessions),
        )


def input_link(urls: FileURLs, lease: InputFile, *, generation: int = 1, page: str = "page") -> ScopedURL:
    return urls.access.input_url(
        urls.context,
        agent_id=urls.agent_id,
        page_session_id=page,
        expected_generation=generation,
        lease_id=lease.lease_id,
    )


def test_real_input_download_and_expired_signature_refresh_without_extending_source(urls: FileURLs) -> None:
    lease = urls.input()
    urls.clock[0] = datetime.now(UTC) - timedelta(seconds=40)
    old = input_link(urls, lease)
    urls.clock[0] = datetime.now(UTC)
    assert urls.read(old)[0] == 404
    fresh = input_link(urls, lease)
    assert fresh.url != old.url
    assert urls.read(fresh) == (200, b"input owned bytes")
    with urls.sessions() as session:
        row = session.get(ExternalAgentFileLease, lease.lease_id)
        assert row is not None
        assert row.expires_at.replace(tzinfo=UTC) == lease.expires_at
    assert fresh.url_expires_at <= lease.expires_at


def test_real_output_projection_url_refresh_and_no_url_persistence(urls: FileURLs) -> None:
    invocation, file = urls.output()
    file_id = file["upload_file_id"]
    assert isinstance(file_id, str)
    link = urls.access.output_url(
        urls.context,
        agent_id=urls.agent_id,
        page_session_id="page",
        expected_generation=1,
        invocation_id=invocation,
        file_id=file_id,
    )
    assert urls.read(link) == (200, b"output owned bytes")
    projected = urls.access.project_outputs(
        urls.context, agent_id=urls.agent_id, invocation_id=invocation, outputs={"report": file}
    )
    assert projected is not None
    assert isinstance(projected["report"], dict)
    assert projected["report"]["url"]
    scope = RuntimeScope(
        tenant_id=urls.context.active_workspace_id,
        initiator_id=urls.context.account_id,
        app_id=None,
        origin="overview_test",
    )
    stored = urls.services.external_agents.repository.get(scope, invocation)
    assert stored.outputs == {"report": file}
    assert "url" not in file


@pytest.mark.parametrize("mutation", ["info", "connection"])
@pytest.mark.parametrize("submitted", [False, True])
def test_edit_revokes_old_urls_but_new_generation_resigns_same_live_input(
    urls: FileURLs, mutation: str, submitted: bool
) -> None:
    lease = urls.input()
    if submitted:
        scope = RuntimeScope(
            tenant_id=urls.context.active_workspace_id,
            initiator_id=urls.context.account_id,
            app_id=None,
            origin="overview_test",
        )
        urls.services.external_agents.repository.create(
            scope,
            InvocationDraft(
                invocation_id=str(uuid4()),
                agent_id=urls.agent_id,
                message_id=str(uuid4()),
                identity=ExecutionIdentity(execution_id=str(uuid4()), node_id="overview-test", frame_id="root"),
                parts=({"text": "Selected input"}, {"fileRef": {"file_id": lease.file_id, "kind": "upload"}}),
                test_generation=1,
                job={"page_session_id": "page", "input_lease_ids": [lease.lease_id]},
            ),
            now=urls.clock[0],
        )
    before_input = input_link(urls, lease)
    invocation, file = urls.output()
    file_id = file["upload_file_id"]
    assert isinstance(file_id, str)
    before_output = urls.access.output_url(
        urls.context,
        agent_id=urls.agent_id,
        page_session_id="page",
        expected_generation=1,
        invocation_id=invocation,
        file_id=file_id,
    )
    assets = urls.services.external_agents.assets
    if mutation == "info":
        assets.update_info(urls.context, agent_id=urls.agent_id, expected_revision=1, changes={"description": "Edited"})
    else:
        from repositories.external_agents.asset_repository import ExternalAssetRepository
        from services.external_agents.contracts import VerificationEvidence

        store = ExternalAssetRepository(session_factory=urls.sessions)
        head = store.get_asset(tenant_id=urls.context.active_workspace_id, agent_id=urls.agent_id)
        now = datetime.now(UTC)
        proof = VerificationEvidence(
            id=str(uuid4()),
            tenant_id=urls.context.active_workspace_id,
            actor_id=urls.context.account_id,
            agent_id=urls.agent_id,
            endpoint="https://changed.example.test",
            interface_url="https://changed.example.test/a2a",
            auth_type="none",
            credential_ciphertext=None,
            card={"name": "Changed", "description": "Declared"},
            capabilities={},
            auth_check="not_exercised",
            fingerprint="b" * 64,
            expected_connection_revision_id=head.active_connection_revision_id,
            created_at=now,
            expires_at=now + timedelta(minutes=10),
        )
        store.save_verification(proof)
        assets.update_connection(
            urls.context,
            agent_id=urls.agent_id,
            verification_id=proof.id,
            expected_revision_id=head.active_connection_revision_id,
            operation_key=str(uuid4()),
        )
    assert urls.read(before_input)[0] == 404
    assert urls.read(before_output)[0] == 404
    fresh = input_link(urls, lease, generation=2)
    assert urls.read(fresh) == (200, b"input owned bytes")
    with pytest.raises(ExternalAgentConflictError):
        urls.access.output_url(
            urls.context,
            agent_id=urls.agent_id,
            page_session_id="page",
            expected_generation=2,
            invocation_id=invocation,
            file_id=file_id,
        )


def test_page_leave_revokes_input_and_output_links_before_physical_cleanup(urls: FileURLs) -> None:
    lease = urls.input()
    link = input_link(urls, lease)
    invocation, file = urls.output()
    file_id = file["upload_file_id"]
    assert isinstance(file_id, str)
    output_link = urls.access.output_url(
        urls.context,
        agent_id=urls.agent_id,
        page_session_id="page",
        expected_generation=1,
        invocation_id=invocation,
        file_id=file_id,
    )
    urls.services.external_agents.retention.leave_test_page(
        tenant_id=urls.context.active_workspace_id,
        actor_id=urls.context.account_id,
        page_session_id="page",
        now=datetime.now(UTC),
    )
    assert urls.read(link)[0] == 404
    assert urls.read(output_link)[0] == 404
    with pytest.raises(ExternalAgentConflictError):
        input_link(urls, lease)


@pytest.mark.parametrize(
    "boundary", ["actor", "tenant", "agent", "page", "generation", "released", "expired", "membership"]
)
def test_issuance_and_download_recheck_scope_without_arbitrary_file_id_authority(urls: FileURLs, boundary: str) -> None:
    lease = urls.input()
    link = input_link(urls, lease)
    context, agent, page, generation = urls.context, urls.agent_id, "page", 1
    if boundary == "actor":
        context = context._replace(account_id=str(uuid4()))
    elif boundary == "tenant":
        context = context._replace(active_workspace_id=str(uuid4()))
    elif boundary == "agent":
        agent = str(uuid4())
    elif boundary == "page":
        page = "another-page"
    elif boundary == "generation":
        generation = 2
    else:
        with urls.sessions.begin() as session:
            row = session.get(ExternalAgentFileLease, lease.lease_id)
            assert row is not None
            if boundary == "released":
                row.released_at = datetime.now(UTC).replace(tzinfo=None)
            elif boundary == "expired":
                row.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
            else:
                membership = session.scalars(
                    select(TenantAccountJoin).where(
                        TenantAccountJoin.tenant_id == context.active_workspace_id,
                        TenantAccountJoin.account_id == context.account_id,
                    )
                ).one()
                membership.role = TenantAccountRole.NORMAL
    with pytest.raises((ExternalAgentForbiddenError, ExternalAgentNotFoundError, ExternalAgentConflictError)):
        urls.access.input_url(
            context, agent_id=agent, page_session_id=page, expected_generation=generation, lease_id=lease.lease_id
        )
    if boundary in {"released", "expired", "membership"}:
        assert urls.read(link)[0] == 404


def test_scope_nonce_and_file_id_tampering_fail_signature_before_delivery(urls: FileURLs) -> None:
    link = input_link(urls, urls.input())
    parsed = urlsplit(link.url)
    query = parse_qs(parsed.query)
    query["nonce"] = [query["nonce"][0] + "x"]
    changed = replace(
        link, url=urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query, doseq=True), ""))
    )
    assert urls.read(changed)[0] == 404
    changed_file = replace(link, url=link.url.replace(link.file_id, str(uuid4()), 1))
    assert urls.read(changed_file)[0] == 404


def test_output_access_cannot_sign_another_invocation_or_an_arbitrary_owned_file(urls: FileURLs) -> None:
    first, _ = urls.output()
    second, other_file = urls.output()
    other_id = other_file["upload_file_id"]
    assert isinstance(other_id, str)
    assert first != second
    ordinary_input = urls.input()
    for file_id in (other_id, ordinary_input.file_id):
        with pytest.raises(ExternalAgentNotFoundError):
            urls.access.output_url(
                urls.context,
                agent_id=urls.agent_id,
                page_session_id="page",
                expected_generation=1,
                invocation_id=first,
                file_id=file_id,
            )
    with urls.sessions.begin() as session:
        foreign = Account(name="Editor", email="other-scoped-file@example.test")
        session.add(foreign)
        session.flush()
        session.add(
            TenantAccountJoin(
                tenant_id=urls.context.active_workspace_id, account_id=foreign.id, role=TenantAccountRole.EDITOR
            )
        )
        actor_id = foreign.id
    with pytest.raises(ExternalAgentNotFoundError):
        urls.access.output_url(
            urls.context._replace(account_id=actor_id),
            agent_id=urls.agent_id,
            page_session_id="page",
            expected_generation=1,
            invocation_id=second,
            file_id=other_id,
        )


def test_expired_output_remains_metadata_without_usable_url_and_cannot_refresh(urls: FileURLs) -> None:
    invocation, file = urls.output()
    file_id = file["upload_file_id"]
    assert isinstance(file_id, str)
    before = urls.access.output_url(
        urls.context,
        agent_id=urls.agent_id,
        page_session_id="page",
        expected_generation=1,
        invocation_id=invocation,
        file_id=file_id,
    )
    with urls.sessions.begin() as session:
        lease = session.scalars(
            select(ExternalAgentFileLease).where(
                ExternalAgentFileLease.invocation_id == invocation, ExternalAgentFileLease.purpose == "output"
            )
        ).one()
        lease.expires_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
    assert urls.read(before)[0] == 404
    projected = urls.access.project_outputs(
        urls.context, agent_id=urls.agent_id, invocation_id=invocation, outputs={"report": file}
    )
    assert projected is not None
    assert isinstance(projected["report"], dict)
    assert projected["report"]["url"] is None
    assert projected["report"]["url_expires_at"] is None
    with pytest.raises(ExternalAgentNotFoundError):
        urls.access.output_url(
            urls.context,
            agent_id=urls.agent_id,
            page_session_id="page",
            expected_generation=1,
            invocation_id=invocation,
            file_id=file_id,
        )


@pytest.mark.parametrize("invalid", ["legacy_mac", "non_ascii_mac", "timestamp", "unknown_version", "oversized_nonce"])
def test_scoped_preview_never_accepts_legacy_or_malformed_capabilities(urls: FileURLs, invalid: str) -> None:
    """The public boundary rejects invalid credentials without decoding claims or storage reads."""
    link = input_link(urls, urls.input())
    parsed = urlsplit(link.url)
    query = {name: values[0] for name, values in parse_qs(parsed.query).items()}
    if invalid == "legacy_mac":
        value = f"file-preview|{link.file_id}|{query['timestamp']}|{query['nonce']}".encode()
        query["sign"] = base64.urlsafe_b64encode(
            hmac.new(dify_config.SECRET_KEY.encode(), value, hashlib.sha256).digest()
        ).decode()
    elif invalid == "non_ascii_mac":
        query["sign"] = "\u00e9" * 44
    elif invalid == "timestamp":
        query["timestamp"] = "invalid"
    elif invalid == "unknown_version":
        query["nonce"] = query["nonce"].replace("byoa.v1.", "byoa.v2.", 1)
    else:
        query["nonce"] = "byoa.v1." + "x" * 4097
    changed = replace(link, url=urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), "")))
    assert urls.read(changed)[0] == 404
