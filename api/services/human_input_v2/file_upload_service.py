"""Issue version-specific upload grants and retain the workflow initiator's file ownership.

Grants only authorize uploads, not approvals. Recheck the delivery's current
recipient authorization and both form deadlines for every upload. Storage and
remote fetching take place after closing all authorization/owner read sessions.
"""

from dataclasses import dataclass
from typing import Literal

import jwt
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.workflow.nodes.human_input.enums import HumanInputFormKind
from graphon.file import helpers as file_helpers
from libs.datetime_utils import to_utc_timestamp
from repositories.factory import DifyAPIRepositoryFactory
from repositories.human_input_v2.form_repository import Form
from repositories.human_input_v2.sqlalchemy_file_upload_repository import SQLAlchemyFileUploadRepository
from services.file_service import FileService, FileUploadActor
from services.human_input_file_upload_service import HumanInputUploadToken, InvalidUploadTokenError
from services.human_input_v2.submission_service import HumanInputSubmissionService
from services.remote_file_service import RemoteFileService, RemoteFileUploadResult

V2_UPLOAD_TOKEN_PREFIX = "hitl_v2_upload_"
_UPLOAD_AUDIENCE = "human-input-v2-file-upload"


class _PublicGrant(BaseModel):
    model_config = ConfigDict(strict=True, frozen=True)
    surface: Literal["public"] = "public"
    form_token: str


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
        grant = _PublicGrant(form_token=form_token)
        form = self._forms.get_public_form(form_token=form_token)
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
            grant = _PublicGrant.model_validate(claims)
        except (jwt.PyJWTError, ValidationError) as exc:
            raise InvalidUploadTokenError() from exc
        form = self._forms.get_public_form(form_token=grant.form_token)
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
