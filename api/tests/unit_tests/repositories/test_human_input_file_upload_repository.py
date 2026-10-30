from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from enums.creator import CreatorUserRole
from models.account import Account, Tenant, TenantAccountJoin
from models.enums import EndUserType
from models.human_input import (
    HumanInputForm,
    HumanInputFormRecipient,
    HumanInputFormUploadFile,
    HumanInputFormUploadToken,
    RecipientType,
    StandaloneWebAppRecipientPayload,
)
from models.model import App, AppMode, EndUser, IconType, UploadFile
from repositories.workflow.human_input.file_upload_repository import SQLAlchemyHumanInputFileUploadRepository
from services.errors.file import UploadFileReferenceNotFoundError
from services.human_input_file_upload_service import HumanInputUploadFormRecord, InvalidUploadTokenError
from services.human_input_service import FormSubmittedError
from tests.unit_tests.model_factories import make_upload_file

_TENANT_ID = "11111111-1111-1111-1111-111111111111"
_OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_APP_ID = "33333333-3333-3333-3333-333333333333"
_OTHER_APP_ID = "44444444-4444-4444-4444-444444444444"
_ACCOUNT_ID = "55555555-5555-5555-5555-555555555555"
_END_USER_ID = "66666666-6666-6666-6666-666666666666"
_FORM_ID = "77777777-7777-7777-7777-777777777777"
_RECIPIENT_ID = "88888888-8888-8888-8888-888888888888"
_FILE_ID = "99999999-9999-9999-9999-999999999999"
_WORKFLOW_RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
_DELIVERY_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
_FORM_TOKEN = "form-token"
_UPLOAD_TOKEN = "hitl_upload_token"
_CREATED_AT = datetime(2026, 1, 1)
_EXPIRATION_TIME = datetime(2099, 1, 1)


def _repository(session_factory: sessionmaker[Session]) -> SQLAlchemyHumanInputFileUploadRepository:
    return SQLAlchemyHumanInputFileUploadRepository(session_factory=session_factory)


def _persist_form_and_recipient(session: Session) -> None:
    session.add(
        HumanInputForm(
            id=_FORM_ID,
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            workflow_run_id=_WORKFLOW_RUN_ID,
            form_kind=HumanInputFormKind.RUNTIME,
            node_id="human-input",
            form_definition="{}",
            rendered_content="content",
            expiration_time=_EXPIRATION_TIME,
            created_at=_CREATED_AT,
        )
    )
    session.add(
        HumanInputFormRecipient(
            id=_RECIPIENT_ID,
            form_id=_FORM_ID,
            delivery_id=_DELIVERY_ID,
            recipient_type=RecipientType.STANDALONE_WEB_APP,
            recipient_payload=StandaloneWebAppRecipientPayload().model_dump_json(),
            access_token=_FORM_TOKEN,
        )
    )
    session.commit()


def _persist_app_owner(session: Session) -> Account:
    tenant = Tenant(name="Workspace")
    tenant.id = _TENANT_ID
    account = Account(name="Owner", email="owner@example.com")
    account.id = _ACCOUNT_ID
    session.add_all(
        [
            tenant,
            account,
            TenantAccountJoin(tenant_id=_TENANT_ID, account_id=_ACCOUNT_ID, current=True),
            App(
                id=_APP_ID,
                tenant_id=_TENANT_ID,
                name="App",
                description="",
                mode=AppMode.WORKFLOW,
                icon_type=IconType.EMOJI,
                icon="app",
                icon_background="#FFFFFF",
                enable_site=True,
                enable_api=True,
                created_by=_ACCOUNT_ID,
                updated_by=_ACCOUNT_ID,
            ),
        ]
    )
    session.commit()
    return account


def _persist_upload(session: Session) -> UploadFile:
    upload = make_upload_file(file_id=_FILE_ID, tenant_id=_TENANT_ID)
    session.add(upload)
    session.commit()
    return upload


def test_form_token_upload_token_grant_and_file_link_round_trip(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app_owner(sqlite_session)
    _persist_form_and_recipient(sqlite_session)
    repository = _repository(sqlite_session_factory)

    form = repository.get_form_by_recipient_token(_FORM_TOKEN)

    assert form is not None
    assert form == HumanInputUploadFormRecord(
        form_id=_FORM_ID,
        recipient_id=_RECIPIENT_ID,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        workflow_run_id=_WORKFLOW_RUN_ID,
        form_kind=HumanInputFormKind.RUNTIME,
        status=HumanInputFormStatus.WAITING,
        submitted_at=None,
        expiration_time=_EXPIRATION_TIME,
        created_at=_CREATED_AT,
    )
    assert repository.get_form_by_recipient_token("missing-token") is None

    repository.create_upload_token(form=form, upload_token=_UPLOAD_TOKEN)
    grant = repository.get_upload_grant(_UPLOAD_TOKEN)

    assert grant is not None
    assert grant.form == form
    assert repository.get_upload_grant("missing-token") is None
    _persist_upload(sqlite_session)

    repository.add_file(
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        form_id=_FORM_ID,
        recipient_id=_RECIPIENT_ID,
        upload_token_id=grant.upload_token_id,
        file_id=_FILE_ID,
        validate_form=lambda _: None,
    )

    with sqlite_session_factory() as session:
        token = session.scalar(
            select(HumanInputFormUploadToken).where(HumanInputFormUploadToken.token == _UPLOAD_TOKEN)
        )
        link = session.scalar(
            select(HumanInputFormUploadFile).where(HumanInputFormUploadFile.upload_file_id == _FILE_ID)
        )

    assert token is not None
    assert token.tenant_id == _TENANT_ID
    assert token.app_id == _APP_ID
    assert token.form_id == _FORM_ID
    assert token.recipient_id == _RECIPIENT_ID
    assert link is not None
    assert link.tenant_id == _TENANT_ID
    assert link.app_id == _APP_ID
    assert link.form_id == _FORM_ID
    assert link.upload_token_id == grant.upload_token_id
    assert link.upload_file_id == _FILE_ID


@pytest.mark.parametrize("deleted_owner", ["app", "form", "recipient", "token"])
def test_add_file_rejects_deleted_owner_and_preserves_upload(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    deleted_owner: str,
) -> None:
    _persist_app_owner(sqlite_session)
    _persist_form_and_recipient(sqlite_session)
    repository = _repository(sqlite_session_factory)
    form = repository.get_form_by_recipient_token(_FORM_TOKEN)
    assert form is not None
    repository.create_upload_token(form=form, upload_token=_UPLOAD_TOKEN)
    grant = repository.get_upload_grant(_UPLOAD_TOKEN)
    assert grant is not None
    _persist_upload(sqlite_session)

    owner_types = {
        "app": (App, _APP_ID),
        "form": (HumanInputForm, _FORM_ID),
        "recipient": (HumanInputFormRecipient, _RECIPIENT_ID),
        "token": (HumanInputFormUploadToken, grant.upload_token_id),
    }
    owner_type, owner_id = owner_types[deleted_owner]
    with sqlite_session_factory.begin() as session:
        session.delete(session.get_one(owner_type, owner_id))

    with pytest.raises(InvalidUploadTokenError):
        repository.add_file(
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            form_id=_FORM_ID,
            recipient_id=_RECIPIENT_ID,
            upload_token_id=grant.upload_token_id,
            file_id=_FILE_ID,
            validate_form=lambda _: None,
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(HumanInputFormUploadFile)) is None
        assert session.get(UploadFile, _FILE_ID) is not None


def test_add_file_rejects_foreign_tenant_upload_without_persisting_metadata(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app_owner(sqlite_session)
    _persist_form_and_recipient(sqlite_session)
    repository = _repository(sqlite_session_factory)
    form = repository.get_form_by_recipient_token(_FORM_TOKEN)
    assert form is not None
    repository.create_upload_token(form=form, upload_token=_UPLOAD_TOKEN)
    grant = repository.get_upload_grant(_UPLOAD_TOKEN)
    assert grant is not None
    with sqlite_session_factory.begin() as session:
        session.add(make_upload_file(file_id=_FILE_ID, tenant_id=_OTHER_TENANT_ID))

    with pytest.raises(UploadFileReferenceNotFoundError):
        repository.add_file(
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            form_id=_FORM_ID,
            recipient_id=_RECIPIENT_ID,
            upload_token_id=grant.upload_token_id,
            file_id=_FILE_ID,
            validate_form=lambda _: None,
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(HumanInputFormUploadFile)) is None


def test_add_file_rejects_deleted_upload_without_persisting_metadata(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app_owner(sqlite_session)
    _persist_form_and_recipient(sqlite_session)
    repository = _repository(sqlite_session_factory)
    form = repository.get_form_by_recipient_token(_FORM_TOKEN)
    assert form is not None
    repository.create_upload_token(form=form, upload_token=_UPLOAD_TOKEN)
    grant = repository.get_upload_grant(_UPLOAD_TOKEN)
    assert grant is not None
    with sqlite_session_factory.begin() as session:
        upload = make_upload_file(file_id=_FILE_ID, tenant_id=_TENANT_ID)
        session.add(upload)
    with sqlite_session_factory.begin() as session:
        session.delete(session.get_one(UploadFile, _FILE_ID))
    with pytest.raises(UploadFileReferenceNotFoundError):
        repository.add_file(
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            form_id=_FORM_ID,
            recipient_id=_RECIPIENT_ID,
            upload_token_id=grant.upload_token_id,
            file_id=_FILE_ID,
            validate_form=lambda _: None,
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(HumanInputFormUploadFile)) is None


def test_add_file_revalidates_current_form_state_before_linking(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app_owner(sqlite_session)
    _persist_form_and_recipient(sqlite_session)
    repository = _repository(sqlite_session_factory)
    form = repository.get_form_by_recipient_token(_FORM_TOKEN)
    assert form is not None
    repository.create_upload_token(form=form, upload_token=_UPLOAD_TOKEN)
    grant = repository.get_upload_grant(_UPLOAD_TOKEN)
    assert grant is not None
    _persist_upload(sqlite_session)
    with sqlite_session_factory.begin() as session:
        current_form = session.get_one(HumanInputForm, _FORM_ID)
        current_form.status = HumanInputFormStatus.SUBMITTED

    def reject_submitted(current_form: HumanInputUploadFormRecord) -> None:
        assert current_form.status == HumanInputFormStatus.SUBMITTED
        raise FormSubmittedError(current_form.form_id)

    with pytest.raises(FormSubmittedError):
        repository.add_file(
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            form_id=_FORM_ID,
            recipient_id=_RECIPIENT_ID,
            upload_token_id=grant.upload_token_id,
            file_id=_FILE_ID,
            validate_form=reject_submitted,
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(HumanInputFormUploadFile)) is None
        assert session.get(UploadFile, _FILE_ID) is not None


def test_get_upload_owner_hydrates_account_for_tenant(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app_owner(sqlite_session)
    other_tenant = Tenant(name="Other Workspace")
    other_tenant.id = _OTHER_TENANT_ID
    sqlite_session.add(other_tenant)
    sqlite_session.commit()
    repository = _repository(sqlite_session_factory)

    owner = repository.get_upload_owner(
        owner_id=_ACCOUNT_ID,
        owner_role=CreatorUserRole.ACCOUNT,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
    )

    assert isinstance(owner, Account)
    assert owner.id == _ACCOUNT_ID
    assert owner.current_tenant_id == _TENANT_ID
    assert (
        repository.get_upload_owner(
            owner_id=_ACCOUNT_ID,
            owner_role=CreatorUserRole.ACCOUNT,
            tenant_id=_OTHER_TENANT_ID,
            app_id=_APP_ID,
        )
        is None
    )


def test_get_upload_owner_scopes_end_user_to_tenant_and_app(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app_owner(sqlite_session)
    end_user = EndUser(
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        type=EndUserType.BROWSER,
        _is_anonymous=False,
        session_id="session",
        external_user_id="external-user",
    )
    end_user.id = _END_USER_ID
    sqlite_session.add(end_user)
    sqlite_session.commit()
    repository = _repository(sqlite_session_factory)

    owner = repository.get_upload_owner(
        owner_id=_END_USER_ID,
        owner_role=CreatorUserRole.END_USER,
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
    )

    assert isinstance(owner, EndUser)
    assert owner.id == _END_USER_ID
    assert (
        repository.get_upload_owner(
            owner_id=_END_USER_ID,
            owner_role=CreatorUserRole.END_USER,
            tenant_id=_OTHER_TENANT_ID,
            app_id=_APP_ID,
        )
        is None
    )
    assert (
        repository.get_upload_owner(
            owner_id=_END_USER_ID,
            owner_role=CreatorUserRole.END_USER,
            tenant_id=_TENANT_ID,
            app_id=_OTHER_APP_ID,
        )
        is None
    )


def test_get_delivery_test_upload_owner_requires_matching_tenant(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app_owner(sqlite_session)
    repository = _repository(sqlite_session_factory)

    owner = repository.get_delivery_test_upload_owner(tenant_id=_TENANT_ID, app_id=_APP_ID)

    assert isinstance(owner, Account)
    assert owner.id == _ACCOUNT_ID
    assert owner.current_tenant_id == _TENANT_ID
    assert repository.get_delivery_test_upload_owner(tenant_id=_OTHER_TENANT_ID, app_id=_APP_ID) is None
