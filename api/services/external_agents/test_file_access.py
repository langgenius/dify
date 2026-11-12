"""Revocable Overview file links; a file ID alone never grants preview access.

The signer uses an isolated MAC domain with the existing UploadFile preview URL shape.
Public delivery must verify that signature before interpreting the nonce, then
re-admit its actor and reread the current page/generation/lease before storage IO.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from machinery.context import RequestContext
from services.upload_file_delivery_service import UploadFileDeliveryNotFoundError

from .contracts import ExternalAgentError, ExternalAgentForbiddenError, ExternalAssetAccess
from .io_contracts import JsonObject, JsonValue


@dataclass(frozen=True, slots=True, kw_only=True)
class TestFileGrant:
    kind: Literal["input", "output"]
    tenant_id: str
    actor_id: str
    agent_id: str
    page_session_id: str
    expected_generation: int
    resource_id: str
    # For inputs resource_id is the exact input lease; for outputs it is the
    # exact Invocation. Neither a name nor an arbitrary tenant-owned file binds.
    file_id: str


@dataclass(frozen=True, slots=True, kw_only=True)
class AuthorizedTestFile:
    grant: TestFileGrant
    expires_at: datetime


@dataclass(frozen=True, slots=True, kw_only=True)
class TestFileURL:
    file_id: str
    url: str
    url_expires_at: datetime


class TestFileAccessStore(Protocol):
    def input_file(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        expected_generation: int | None,
        lease_id: str,
    ) -> AuthorizedTestFile:
        """Read the complete live owned input chain and current generation.

        None generation is exclusively for a just-completed upload response;
        authenticated refresh routes supply the explicit expected generation.
        A retained input may survive a presentation edit, but its old signed
        URL does not: every new grant pins the current generation.
        """
        ...

    def output_file(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        expected_generation: int,
        invocation_id: str,
        file_id: str,
    ) -> AuthorizedTestFile:
        """Require an exact live Overview Invocation and a published output lease."""
        ...

    def output_page(self, context: RequestContext, *, agent_id: str, invocation_id: str) -> tuple[str, int]:
        """Reconstruct owned current output scope from persisted server state."""
        ...


class TestFileURLSigner(Protocol):
    def issue(self, file: AuthorizedTestFile) -> TestFileURL:
        """Sign a scoped nonce for at most the signature TTL and source lifetime."""
        ...

    def is_scoped(self, nonce: str) -> bool: ...

    def verify(
        self,
        *,
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
        preview_kind: Literal["file-preview", "image-preview"],
    ) -> bool:
        """Verify the isolated MAC and TTL before any claims are decoded."""
        ...

    def decode_verified_nonce(self, nonce: str) -> TestFileGrant:
        """Decode only after the isolated scoped HMAC/TTL check succeeded."""
        ...


class ExternalTestFileAccessService:
    def __init__(self, *, store: TestFileAccessStore, access: ExternalAssetAccess, signer: TestFileURLSigner) -> None:
        self._store, self._access, self._signer = store, access, signer

    def _admit(self, context: RequestContext, agent_id: str) -> None:
        """Recheck current membership/visibility for both issuance and signed delivery."""
        visible = self._access.visible_agent_ids(context)
        if self._access.role(context) not in {"owner", "admin", "editor"} or (
            visible is not None and agent_id not in visible
        ):
            raise ExternalAgentForbiddenError("The current actor cannot access this Test file.")

    def input_url(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        expected_generation: int | None,
        lease_id: str,
    ) -> TestFileURL:
        """Issue only after the live page/input lease and admitted actor are checked."""
        self._admit(context, agent_id)
        return self._signer.issue(
            self._store.input_file(
                context,
                agent_id=agent_id,
                page_session_id=page_session_id,
                expected_generation=expected_generation,
                lease_id=lease_id,
            )
        )

    def output_url(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        expected_generation: int,
        invocation_id: str,
        file_id: str,
    ) -> TestFileURL:
        """Issue only for a published file in this exact current owned Overview result."""
        self._admit(context, agent_id)
        return self._signer.issue(
            self._store.output_file(
                context,
                agent_id=agent_id,
                page_session_id=page_session_id,
                expected_generation=expected_generation,
                invocation_id=invocation_id,
                file_id=file_id,
            )
        )

    def verify_signature(
        self,
        *,
        file_id: str,
        timestamp: str,
        nonce: str,
        sign: str,
        preview_kind: Literal["file-preview", "image-preview"],
    ) -> bool:
        """Authenticate scoped delivery without querying claims or source state."""
        return self._signer.verify(
            file_id=file_id, timestamp=timestamp, nonce=nonce, sign=sign, preview_kind=preview_kind
        )

    def authorize(self, *, file_id: str, nonce: str) -> None:
        """Apply scoped nonce revocation after the public endpoint verified HMAC/TTL.

        Ordinary existing signed URLs keep their prior behavior. A valid BYOA
        signature is not a bypass of current roles, page, generation or leases.
        Public failures use the existing opaque file-not-found contract.
        """
        if self._signer.is_scoped(nonce):
            try:
                grant = self._signer.decode_verified_nonce(nonce)
                if grant.file_id != file_id:
                    raise ValueError("The scoped file does not match.")
                context = RequestContext("signed-test-file", None, grant.actor_id, grant.tenant_id)
                self._admit(context, grant.agent_id)
                if grant.kind == "input":
                    current = self._store.input_file(
                        context,
                        agent_id=grant.agent_id,
                        page_session_id=grant.page_session_id,
                        expected_generation=grant.expected_generation,
                        lease_id=grant.resource_id,
                    )
                else:
                    current = self._store.output_file(
                        context,
                        agent_id=grant.agent_id,
                        page_session_id=grant.page_session_id,
                        expected_generation=grant.expected_generation,
                        invocation_id=grant.resource_id,
                        file_id=file_id,
                    )
                if current.grant != grant:
                    raise ValueError("The scoped file changed.")
            except (ExternalAgentError, ValueError, LookupError) as error:
                raise UploadFileDeliveryNotFoundError("File not found or signature is invalid") from error

    def project_outputs(
        self, context: RequestContext, *, agent_id: str, invocation_id: str, outputs: JsonObject | None
    ) -> JsonObject | None:
        """Attach ephemeral URLs without modifying persisted output or run success.

        Expired individual files retain display metadata with no usable URL;
        permission/generation failures for the result itself still propagate.
        """
        if outputs is None:
            return None
        page, generation = self._store.output_page(context, agent_id=agent_id, invocation_id=invocation_id)

        def project(value: JsonValue) -> JsonValue:
            if isinstance(value, dict):
                file_id = value.get("upload_file_id")
                if value.get("dify_model_identity") == "__dify__file__" and isinstance(file_id, str):
                    from .contracts import ExternalAgentNotFoundError

                    try:
                        link = self.output_url(
                            context,
                            agent_id=agent_id,
                            page_session_id=page,
                            expected_generation=generation,
                            invocation_id=invocation_id,
                            file_id=file_id,
                        )
                    except ExternalAgentNotFoundError:
                        return {**value, "url": None, "url_expires_at": None}
                    return {**value, "url": link.url, "url_expires_at": link.url_expires_at.isoformat()}
                return {key: project(item) for key, item in value.items()}
            if isinstance(value, list):
                return [project(item) for item in value]
            return value

        return {key: project(value) for key, value in outputs.items()}
