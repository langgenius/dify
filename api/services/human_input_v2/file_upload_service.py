"""Issue version-specific upload grants and retain the workflow initiator's file ownership.

Grants only authorize uploads, not approvals. Recheck the delivery's current
recipient authorization and both form deadlines for every upload. Storage and
remote fetching take place after closing all authorization/owner read sessions.
"""

import hashlib
from dataclasses import dataclass
from typing import Annotated, Literal

import jwt
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.human_input_v2.shared.values import TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind
from graphon.file import helpers as file_helpers
from libs.datetime_utils import naive_utc_now, to_utc_timestamp
from models.enums import CreatorUserRole
from repositories.factory import DifyAPIRepositoryFactory
from repositories.human_input_v2.form_repository import Form
from repositories.human_input_v2.sqlalchemy_file_upload_repository import SQLAlchemyFileUploadRepository
from services.file_service import FileService, FileUploadActor
from services.human_input_file_upload_service import HumanInputUploadToken, InvalidUploadTokenError
from services.human_input_v2.submission_service import (
    HumanInputFormError,
    HumanInputFormErrorCode,
    HumanInputSubmissionService,
    ServiceAPIFormActor,
    WebAppFormActor,
)
from services.remote_file_service import RemoteFileService, RemoteFileUploadResult

V2_UPLOAD_TOKEN_PREFIX = "hitl_v2_upload_"
_UPLOAD_AUDIENCE = "human-input-v2-file-upload"


class _PublicGrant(BaseModel):
    model_config = ConfigDict(strict=True, frozen=True)
    surface: Literal["public"] = "public"
    form_token: str


class _WebAppGrant(BaseModel):
    model_config = ConfigDict(strict=True, frozen=True)
    surface: Literal["web_app"] = "web_app"
    form_token: str
    tenant_id: str
    app_id: str
    end_user_id: str


class _ServiceAPIGrant(BaseModel):
    model_config = ConfigDict(strict=True, frozen=True)
    surface: Literal["service_api"] = "service_api"
    form_token: str
    tenant_id: str
    app_id: str


_Grant = _PublicGrant | _WebAppGrant | _ServiceAPIGrant
_GRANT_ADAPTER = TypeAdapter(Annotated[_Grant, Field(discriminator="surface")])


@dataclass(frozen=True, slots=True)
class HumanInputV2UploadContext:
    form: Form
    owner: FileUploadActor


class HumanInputV2FileUploadService:
    def __init__(
        self, *, session_factory: sessionmaker[Session], files: FileService, remote_files: RemoteFileService
    ) -> None:
        self._sessions = session_factory
        self._forms = HumanInputSubmissionService(session_factory=session_factory)
        self._files = files
        self._remote_files = remote_files

    def issue_public_upload_token(self, form_token: str) -> HumanInputUploadToken:
        return self._issue_upload_token(_PublicGrant(form_token=form_token))

    def issue_web_app_upload_token(self, *, actor: WebAppFormActor, form_token: str) -> HumanInputUploadToken:
        """Require the read/submit passport actor; issue only an upload grant for its active delivery."""
        return self._issue_upload_token(
            _WebAppGrant(
                form_token=form_token, tenant_id=actor.tenant_id, app_id=actor.app_id, end_user_id=actor.end_user_id
            )
        )

    def issue_service_api_upload_token(self, *, actor: ServiceAPIFormActor, form_token: str) -> HumanInputUploadToken:
        """Require the read/submit app actor; issue an upload grant preserving the original file owner."""
        return self._issue_upload_token(
            _ServiceAPIGrant(form_token=form_token, tenant_id=actor.tenant_id, app_id=actor.app_id)
        )

    def _authorize_grant(self, grant: _Grant) -> Form:
        """Recheck the signed actor's current delivery and deadlines without recording a form view."""
        if isinstance(grant, _PublicGrant):
            return self._forms.authorize_public_form(form_token=grant.form_token)
        token_hash = hashlib.sha256(grant.form_token.encode()).hexdigest()
        with self._sessions() as session:
            if isinstance(grant, _WebAppGrant):
                form = self._forms._authorize_web_app(
                    session,
                    actor=WebAppFormActor(TenantId(grant.tenant_id), grant.app_id, grant.end_user_id),
                    token_hash=token_hash,
                ).form
            else:
                form = self._forms._authorize_service_api(
                    session,
                    actor=ServiceAPIFormActor(TenantId(grant.tenant_id), grant.app_id),
                    token_hash=token_hash,
                ).form
        if naive_utc_now() >= min(form.expiration_time, form.global_timeout_deadline):
            raise HumanInputFormError(HumanInputFormErrorCode.EXPIRED, form_id=form.id)
        return form

    def _issue_upload_token(self, grant: _Grant) -> HumanInputUploadToken:
        form = self._authorize_grant(grant)
        self._resolve_owner(form)
        expires_at = min(form.expiration_time, form.global_timeout_deadline)
        claims = {**grant.model_dump(), "aud": _UPLOAD_AUDIENCE, "exp": to_utc_timestamp(expires_at)}
        token = jwt.encode(claims, dify_config.SECRET_KEY, algorithm="HS256")
        return HumanInputUploadToken(upload_token=V2_UPLOAD_TOKEN_PREFIX + token, expires_at=expires_at)

    def validate_upload_token(self, upload_token: str) -> HumanInputV2UploadContext:
        if not upload_token.startswith(V2_UPLOAD_TOKEN_PREFIX):
            raise InvalidUploadTokenError()
        try:
            claims = jwt.decode(
                upload_token.removeprefix(V2_UPLOAD_TOKEN_PREFIX),
                dify_config.SECRET_KEY,
                algorithms=["HS256"],
                audience=_UPLOAD_AUDIENCE,
                options={"require": ["exp", "aud"]},
            )
            grant = _GRANT_ADAPTER.validate_python(claims)
        except (jwt.PyJWTError, ValidationError) as exc:
            raise InvalidUploadTokenError() from exc
        form = self._authorize_grant(grant)
        return HumanInputV2UploadContext(form=form, owner=self._resolve_owner(form))

    def upload_local_file(
        self, *, context: HumanInputV2UploadContext, filename: str, content: bytes, mimetype: str
    ) -> RemoteFileUploadResult:
        uploaded = self._files.upload_file(
            filename=filename,
            content=content,
            mimetype=mimetype,
            user=context.owner,
            tenant_id=str(context.form.tenant_id),
        )
        return RemoteFileUploadResult(
            id=uploaded.id,
            name=uploaded.name,
            size=uploaded.size,
            extension=uploaded.extension,
            url=file_helpers.get_signed_file_url(upload_file_id=uploaded.id),
            mime_type=uploaded.mime_type,
            created_by=uploaded.created_by,
            created_at=uploaded.created_at,
        )

    def upload_remote_file(self, *, context: HumanInputV2UploadContext, url: str) -> RemoteFileUploadResult:
        return self._remote_files.upload_from_url(url=url, user=context.owner, tenant_id=str(context.form.tenant_id))

    def _resolve_owner(self, form: Form) -> FileUploadActor:
        if form.run_gateway == "enterprise":
            reference = form.owner_ref or {}
            subject = reference.get("file_owner_subject")
            if subject is not None:
                with self._sessions() as session:
                    owner = SQLAlchemyFileUploadRepository(session).get_file_grant_owner(
                        tenant_id=str(form.tenant_id), app_id=form.app_id, subject=subject
                    )
                if owner is None:
                    raise InvalidUploadTokenError()
                return FileUploadActor(id=owner.id, creator_role=owner.creator_role)
            role = {
                "end_user": CreatorUserRole.END_USER,
                "account": CreatorUserRole.ACCOUNT,
            }.get(reference.get("initiator_type", ""))
            if role is None or "initiator_id" not in reference:
                raise InvalidUploadTokenError()
            with self._sessions() as session:
                owner = SQLAlchemyFileUploadRepository(session).get_owner(
                    tenant_id=str(form.tenant_id),
                    app_id=form.app_id,
                    owner_id=reference["initiator_id"],
                    owner_role=role,
                )
            if owner is None:
                raise InvalidUploadTokenError()
            return FileUploadActor(id=owner.id, creator_role=owner.creator_role)
        if form.workflow_run_id is not None:
            runs = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._sessions)
            run = runs.get_workflow_run_by_id(
                tenant_id=str(form.tenant_id), app_id=form.app_id, run_id=form.workflow_run_id
            )
            if run is None:
                raise InvalidUploadTokenError()
            with self._sessions() as session:
                owner = SQLAlchemyFileUploadRepository(session).get_owner(
                    tenant_id=str(form.tenant_id),
                    app_id=form.app_id,
                    owner_id=run.created_by,
                    owner_role=run.created_by_role,
                )
        elif form.form_kind == HumanInputFormKind.DELIVERY_TEST:
            with self._sessions() as session:
                owner = SQLAlchemyFileUploadRepository(session).get_delivery_test_owner(
                    tenant_id=str(form.tenant_id), app_id=form.app_id
                )
        else:
            raise InvalidUploadTokenError()
        if owner is None:
            raise InvalidUploadTokenError()
        return FileUploadActor(id=owner.id, creator_role=owner.creator_role)


def build_file_upload_service() -> HumanInputV2FileUploadService:
    from core.db.session_factory import session_factory
    from extensions.ext_application_services import application_services

    services = application_services()
    return HumanInputV2FileUploadService(
        session_factory=session_factory.get_session_maker(), files=services.files, remote_files=services.remote_files
    )
