"""SQLAlchemy persistence adapter for human-input file uploads."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, Tenant
from models.enums import CreatorUserRole
from models.human_input import (
    HumanInputForm,
    HumanInputFormRecipient,
    HumanInputFormUploadFile,
    HumanInputFormUploadToken,
)
from models.model import App, EndUser
from services.human_input_file_upload_service import (
    HumanInputFileUploadRepository,
    HumanInputUploadFormRecord,
    HumanInputUploadGrantRecord,
)


class SQLAlchemyHumanInputFileUploadRepository(HumanInputFileUploadRepository):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_form_by_recipient_token(self, form_token: str) -> HumanInputUploadFormRecord | None:
        stmt = (
            select(HumanInputFormRecipient, HumanInputForm)
            .join(HumanInputForm, HumanInputForm.id == HumanInputFormRecipient.form_id)
            .where(HumanInputFormRecipient.access_token == form_token)
            .limit(1)
        )
        with self._session_factory() as session:
            row = session.execute(stmt).one_or_none()
            if row is None:
                return None
            recipient, form = row
            return self._to_form_record(form=form, recipient_id=recipient.id)

    @override
    def create_upload_token(self, *, form: HumanInputUploadFormRecord, upload_token: str) -> None:
        with self._session_factory.begin() as session:
            session.add(
                HumanInputFormUploadToken(
                    tenant_id=form.tenant_id,
                    app_id=form.app_id,
                    form_id=form.form_id,
                    recipient_id=form.recipient_id,
                    token=upload_token,
                )
            )

    @override
    def get_upload_grant(self, upload_token: str) -> HumanInputUploadGrantRecord | None:
        stmt = (
            select(HumanInputFormUploadToken, HumanInputForm)
            .join(HumanInputForm, HumanInputForm.id == HumanInputFormUploadToken.form_id)
            .where(HumanInputFormUploadToken.token == upload_token)
            .limit(1)
        )
        with self._session_factory() as session:
            row = session.execute(stmt).one_or_none()
            if row is None:
                return None
            token, form = row
            return HumanInputUploadGrantRecord(
                upload_token_id=token.id,
                form=self._to_form_record(form=form, recipient_id=token.recipient_id),
            )

    @override
    def get_upload_owner(
        self,
        *,
        owner_id: str,
        owner_role: CreatorUserRole,
        tenant_id: str,
        app_id: str,
    ) -> Account | EndUser | None:
        with self._session_factory() as session:
            if owner_role == CreatorUserRole.END_USER:
                return session.scalar(
                    select(EndUser)
                    .where(
                        EndUser.id == owner_id,
                        EndUser.tenant_id == tenant_id,
                        EndUser.app_id == app_id,
                    )
                    .limit(1)
                )

            if owner_role != CreatorUserRole.ACCOUNT:
                return None

            account = session.scalar(select(Account).where(Account.id == owner_id).limit(1))
            tenant = session.scalar(select(Tenant).where(Tenant.id == tenant_id).limit(1))
            if account is None or tenant is None:
                return None

            account.set_current_tenant_with_session(tenant, session=session)
            if account.current_tenant_id != tenant_id:
                return None
            return account

    @override
    def get_delivery_test_upload_owner(self, *, tenant_id: str, app_id: str) -> Account | None:
        with self._session_factory() as session:
            app = session.scalar(
                select(App)
                .where(
                    App.id == app_id,
                    App.tenant_id == tenant_id,
                )
                .limit(1)
            )
            if app is None or app.created_by is None:
                return None

            account = session.scalar(select(Account).where(Account.id == app.created_by).limit(1))
            tenant = session.scalar(select(Tenant).where(Tenant.id == tenant_id).limit(1))
            if account is None or tenant is None:
                return None

            account.set_current_tenant_with_session(tenant, session=session)
            if account.current_tenant_id != tenant_id:
                return None
            return account

    @override
    def add_file(
        self,
        *,
        tenant_id: str,
        app_id: str,
        form_id: str,
        upload_token_id: str,
        file_id: str,
    ) -> None:
        with self._session_factory.begin() as session:
            session.add(
                HumanInputFormUploadFile(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    form_id=form_id,
                    upload_file_id=file_id,
                    upload_token_id=upload_token_id,
                )
            )

    @staticmethod
    def _to_form_record(*, form: HumanInputForm, recipient_id: str) -> HumanInputUploadFormRecord:
        return HumanInputUploadFormRecord(
            form_id=form.id,
            recipient_id=recipient_id,
            tenant_id=form.tenant_id,
            app_id=form.app_id,
            workflow_run_id=form.workflow_run_id,
            form_kind=form.form_kind,
            status=form.status,
            submitted_at=form.submitted_at,
            expiration_time=form.expiration_time,
            created_at=form.created_at,
        )
