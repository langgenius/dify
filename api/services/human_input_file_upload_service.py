from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from configs import dify_config
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.account import Account, Tenant
from models.enums import CreatorUserRole
from models.human_input import (
    HumanInputForm,
    HumanInputFormRecipient,
    HumanInputFormUploadFile,
    HumanInputFormUploadToken,
)
from models.model import App, EndUser
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from services.human_input_service import FormExpiredError, FormNotFoundError, FormSubmittedError

HITL_UPLOAD_TOKEN_PREFIX = "hitl_upload_"
_TOKEN_RANDOM_BYTES = 32
_TOKEN_GENERATION_ATTEMPTS = 10


@dataclass(frozen=True)
class HumanInputUploadToken:
    upload_token: str
    expires_at: datetime


@dataclass(frozen=True)
class HumanInputUploadContext:
    tenant_id: str
    app_id: str
    form_id: str
    recipient_id: str
    upload_token_id: str
    owner: Account | EndUser


class InvalidUploadTokenError(Exception):
    pass


class HumanInputFileUploadService:
    """Coordinates HITL upload tokens, workflow-run owners, and form-file links.

    Standalone HITL uploads must be owned by the original workflow/chatflow
    initiator so that resume-time file restoration continues to flow through the
    normal file access checks. Delivery-test forms have no workflow run, so their
    uploads are scoped to the app creator account inside the form tenant.
    """

    _session_maker: sessionmaker[Session]
    _workflow_run_repository: APIWorkflowRunRepository

    def __init__(
        self,
        session_factory: sessionmaker[Session] | Engine,
        workflow_run_repository: APIWorkflowRunRepository,
    ) -> None:
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_maker = session_factory
        self._workflow_run_repository = workflow_run_repository

    def issue_upload_token(self, form_token: str) -> HumanInputUploadToken:
        """Create an upload token for an active human input recipient token."""

        with self._session_maker() as session, session.begin():
            recipient_model = session.scalar(
                select(HumanInputFormRecipient)
                .options(selectinload(HumanInputFormRecipient.form))
                .where(HumanInputFormRecipient.access_token == form_token)
                .limit(1)
            )
            if recipient_model is None or recipient_model.form is None:
                raise FormNotFoundError()

            form = recipient_model.form
            self._ensure_form_model_active(form)
            upload_token = self._generate_unique_upload_token()
            token_model = HumanInputFormUploadToken(
                tenant_id=form.tenant_id,
                app_id=form.app_id,
                form_id=form.id,
                recipient_id=recipient_model.id,
                token=upload_token,
            )
            session.add(token_model)
            # Snapshot the expiry before commit so callers do not depend on the
            # session factory's expire_on_commit policy.
            token = HumanInputUploadToken(upload_token=upload_token, expires_at=form.expiration_time)

        return token

    def validate_upload_token(self, upload_token: str) -> HumanInputUploadContext:
        """Resolve an upload token and ensure the bound form is still active."""

        query = (
            select(HumanInputFormUploadToken)
            .options(selectinload(HumanInputFormUploadToken.form))
            .where(HumanInputFormUploadToken.token == upload_token)
            .limit(1)
        )
        with self._session_maker(expire_on_commit=False) as session:
            token_model = session.scalars(query).first()
            if token_model is None:
                raise InvalidUploadTokenError()

            form_model = token_model.form
            if form_model is None:
                raise InvalidUploadTokenError()
            self._ensure_form_model_active(form_model)

            owner = self._resolve_upload_owner(session=session, form_model=form_model)

            return HumanInputUploadContext(
                tenant_id=token_model.tenant_id,
                app_id=token_model.app_id,
                form_id=token_model.form_id,
                recipient_id=token_model.recipient_id,
                upload_token_id=token_model.id,
                owner=owner,
            )

    def record_upload_file(self, *, context: HumanInputUploadContext, file_id: str) -> None:
        """Record that a file was uploaded through a specific form upload token."""

        with self._session_maker() as session, session.begin():
            session.add(
                HumanInputFormUploadFile(
                    tenant_id=context.tenant_id,
                    app_id=context.app_id,
                    form_id=context.form_id,
                    upload_file_id=file_id,
                    upload_token_id=context.upload_token_id,
                )
            )

    def _generate_unique_upload_token(self) -> str:
        return f"{HITL_UPLOAD_TOKEN_PREFIX}{secrets.token_urlsafe(_TOKEN_RANDOM_BYTES)}"

    def _resolve_upload_owner(
        self,
        *,
        session: Session,
        form_model: HumanInputForm,
    ) -> Account | EndUser:
        if form_model.workflow_run_id is None:
            if form_model.form_kind == HumanInputFormKind.DELIVERY_TEST:
                return self._resolve_delivery_test_upload_owner(session=session, form_model=form_model)
            raise InvalidUploadTokenError()

        workflow_run = self._workflow_run_repository.get_workflow_run_by_id(
            tenant_id=form_model.tenant_id,
            app_id=form_model.app_id,
            run_id=form_model.workflow_run_id,
        )
        if workflow_run is None:
            raise InvalidUploadTokenError()

        if workflow_run.created_by_role == CreatorUserRole.END_USER:
            end_user = session.scalar(
                select(EndUser)
                .where(
                    EndUser.id == workflow_run.created_by,
                    EndUser.tenant_id == workflow_run.tenant_id,
                    EndUser.app_id == workflow_run.app_id,
                )
                .limit(1)
            )
            if end_user is None:
                raise InvalidUploadTokenError()
            return end_user

        if workflow_run.created_by_role != CreatorUserRole.ACCOUNT:
            raise InvalidUploadTokenError()

        account = session.scalar(select(Account).where(Account.id == workflow_run.created_by).limit(1))
        if account is None:
            raise InvalidUploadTokenError()

        tenant = session.scalar(select(Tenant).where(Tenant.id == workflow_run.tenant_id).limit(1))
        if tenant is None:
            raise InvalidUploadTokenError()

        # HITL upload runs outside the normal account auth flow, so hydrate the
        # account tenant context explicitly before delegating to FileService.
        account.set_current_tenant_with_session(tenant, session=session)
        return account

    def _resolve_delivery_test_upload_owner(
        self,
        *,
        session: Session,
        form_model: HumanInputForm,
    ) -> Account:
        app = session.scalar(
            select(App)
            .where(
                App.id == form_model.app_id,
                App.tenant_id == form_model.tenant_id,
            )
            .limit(1)
        )
        if app is None or app.created_by is None:
            raise InvalidUploadTokenError()

        account = session.scalar(select(Account).where(Account.id == app.created_by).limit(1))
        if account is None:
            raise InvalidUploadTokenError()

        tenant = session.scalar(select(Tenant).where(Tenant.id == form_model.tenant_id).limit(1))
        if tenant is None:
            raise InvalidUploadTokenError()

        account.set_current_tenant_with_session(tenant, session=session)
        if account.current_tenant_id != form_model.tenant_id:
            raise InvalidUploadTokenError()
        return account

    @staticmethod
    def _ensure_form_model_active(form: HumanInputForm) -> None:
        if form.submitted_at is not None or form.status == HumanInputFormStatus.SUBMITTED:
            raise FormSubmittedError(form.id)
        if form.status in {HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED}:
            raise FormExpiredError(form.id)

        now = naive_utc_now()
        if ensure_naive_utc(form.expiration_time) <= now:
            raise FormExpiredError(form.id)

        global_timeout_seconds = dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS
        if global_timeout_seconds <= 0 or form.workflow_run_id is None:
            return
        global_deadline = ensure_naive_utc(form.created_at) + timedelta(seconds=global_timeout_seconds)
        if global_deadline <= now:
            raise FormExpiredError(form.id)
