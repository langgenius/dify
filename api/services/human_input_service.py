import abc
import json
from collections.abc import Mapping
from typing import Any

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, selectinload, sessionmaker

from core.workflow.nodes.human_input.entities import FormDefinition
from libs.datetime_utils import naive_utc_now
from libs.exception import BaseHTTPException
from models.account import Account
from models.human_input import HumanInputForm, HumanInputFormRecipient, RecipientType


class Form:
    def __init__(self, form_model: HumanInputForm):
        self._form_model = form_model

    @abc.abstractmethod
    def get_definition(self) -> FormDefinition:
        pass

    @abc.abstractmethod
    def submitted(self) -> bool:
        pass


class HumanInputError(Exception):
    pass


class FormSubmittedError(HumanInputError, BaseHTTPException):
    error_code = "human_input_form_submitted"
    description = "This form has already been submitted by another user, form_id={form_id}"
    code = 412

    def __init__(self, form_id: str):
        description = self.description.format(form_id=form_id)
        super().__init__(description=description)


class FormNotFoundError(HumanInputError, BaseHTTPException):
    error_code = "human_input_form_not_found"
    code = 404


class WebAppDeliveryNotEnabledError(HumanInputError, BaseException):
    pass


class HumanInputService:
    def __init__(
        self,
        session_factory: sessionmaker[Session] | Engine,
    ):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory

    def get_form_by_token(self, form_token: str) -> Form | None:
        query = (
            select(HumanInputFormRecipient)
            .options(selectinload(HumanInputFormRecipient.form))
            .where(HumanInputFormRecipient.access_token == form_token)
        )
        with self._session_factory(expire_on_commit=False) as session:
            recipient = session.scalars(query).first()
        if recipient is None:
            return None

        return Form(recipient.form)

    def get_form_by_id(self, form_id: str) -> Form | None:
        query = select(HumanInputForm).where(HumanInputForm.id == form_id)
        with self._session_factory(expire_on_commit=False) as session:
            form_model = session.scalars(query).first()
        if form_model is None:
            return None

        return Form(form_model)

    def submit_form_by_id(self, form_id: str, user: Account, selected_action_id: str, form_data: Mapping[str, Any]):
        recipient_query = (
            select(HumanInputFormRecipient)
            .options(selectinload(HumanInputFormRecipient.form))
            .where(
                HumanInputFormRecipient.recipient_type == RecipientType.WEBAPP,
                HumanInputFormRecipient.form_id == form_id,
            )
        )

        with self._session_factory(expire_on_commit=False) as session:
            recipient_model = session.scalars(recipient_query).first()

        if recipient_model is None:
            raise WebAppDeliveryNotEnabledError()

        form_model = recipient_model.form
        form = Form(form_model)
        if form.submitted:
            raise FormSubmittedError(form_model.id)

        with self._session_factory(expire_on_commit=False) as session, session.begin():
            form_model.selected_action_id = selected_action_id
            form_model.submitted_data = json.dumps(form_data)
            form_model.submitted_at = naive_utc_now()
            form_model.submission_user_id = user.id

            form_model.completed_by_recipient_id = recipient_model.id
            session.add(form_model)
        # TODO: restart the execution of paused workflow

    def submit_form_by_token(self, form_token: str, selected_action_id: str, form_data: Mapping[str, Any]):
        recipient_query = (
            select(HumanInputFormRecipient)
            .options(selectinload(HumanInputFormRecipient.form))
            .where(
                HumanInputFormRecipient.form_id == form_token,
            )
        )

        with self._session_factory(expire_on_commit=False) as session:
            recipient_model = session.scalars(recipient_query).first()

        if recipient_model is None:
            raise WebAppDeliveryNotEnabledError()

        form_model = recipient_model.form
        form = Form(form_model)
        if form.submitted:
            raise FormSubmittedError(form_model.id)

        with self._session_factory(expire_on_commit=False) as session, session.begin():
            form_model.selected_action_id = selected_action_id
            form_model.submitted_data = json.dumps(form_data)
            form_model.submitted_at = naive_utc_now()
            form_model.submission_user_id = user.id

            form_model.completed_by_recipient_id = recipient_model.id
            session.add(form_model)
