import abc
from collections.abc import Mapping
from typing import Any

from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.workflow.nodes.human_input.entities import FormDefinition
from libs.exception import BaseHTTPException
from models.human_input import RecipientType


class Form(abc.ABC):
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


class FormNotFoundError(HumanInputError, BaseException):
    error_code = "human_input_form_not_found"
    code = 404


class HumanInputService:
    def __init__(
        self,
        session_factory: sessionmaker | Engine,
    ):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory

    def get_form_definition_by_token(self, recipient_type: RecipientType, form_token: str) -> Form:
        pass

    def get_form_definition_by_id(self, form_id: str) -> Form | None:
        pass

    def submit_form_by_id(self, form_id: str, selected_action_id: str, form_data: Mapping[str, Any]):
        pass

    def submit_form_by_token(
        self, recipient_type: RecipientType, form_token: str, selected_action_id: str, form_data: Mapping[str, Any]
    ):
        pass
