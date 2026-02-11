"""Utilities for testing HumanInputNode without database dependencies."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from core.workflow.repositories.human_input_form_repository import (
    FormCreateParams,
    HumanInputFormEntity,
    HumanInputFormRecipientEntity,
    HumanInputFormRepository,
)
from libs.datetime_utils import naive_utc_now


class _InMemoryFormRecipient(HumanInputFormRecipientEntity):
    """Minimal recipient entity required by the repository interface."""

    def __init__(self, recipient_id: str, token: str) -> None:
        self._id = recipient_id
        self._token = token

    @property
    def id(self) -> str:
        return self._id

    @property
    def token(self) -> str:
        return self._token


@dataclass
class _InMemoryFormEntity(HumanInputFormEntity):
    form_id: str
    rendered: str
    token: str | None = None
    action_id: str | None = None
    data: Mapping[str, Any] | None = None
    is_submitted: bool = False
    status_value: HumanInputFormStatus = HumanInputFormStatus.WAITING
    expiration: datetime = naive_utc_now()

    @property
    def id(self) -> str:
        return self.form_id

    @property
    def web_app_token(self) -> str | None:
        return self.token

    @property
    def recipients(self) -> list[HumanInputFormRecipientEntity]:
        return []

    @property
    def rendered_content(self) -> str:
        return self.rendered

    @property
    def selected_action_id(self) -> str | None:
        return self.action_id

    @property
    def submitted_data(self) -> Mapping[str, Any] | None:
        return self.data

    @property
    def submitted(self) -> bool:
        return self.is_submitted

    @property
    def status(self) -> HumanInputFormStatus:
        return self.status_value

    @property
    def expiration_time(self) -> datetime:
        return self.expiration


class InMemoryHumanInputFormRepository(HumanInputFormRepository):
    """Pure in-memory repository used by workflow graph engine tests."""

    def __init__(self) -> None:
        self._form_counter = 0
        self.created_params: list[FormCreateParams] = []
        self.created_forms: list[_InMemoryFormEntity] = []
        self._forms_by_key: dict[tuple[str, str], _InMemoryFormEntity] = {}

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        self.created_params.append(params)
        self._form_counter += 1
        form_id = f"form-{self._form_counter}"
        token = f"console-{form_id}" if params.console_recipient_required else f"token-{form_id}"
        entity = _InMemoryFormEntity(
            form_id=form_id,
            rendered=params.rendered_content,
            token=token,
        )
        self.created_forms.append(entity)
        self._forms_by_key[(params.workflow_execution_id, params.node_id)] = entity
        return entity

    def get_form(self, workflow_execution_id: str, node_id: str) -> HumanInputFormEntity | None:
        return self._forms_by_key.get((workflow_execution_id, node_id))

    # Convenience helpers for tests -------------------------------------

    def set_submission(self, *, action_id: str, form_data: Mapping[str, Any] | None = None) -> None:
        """Simulate a human submission for the next repository lookup."""

        if not self.created_forms:
            raise AssertionError("no form has been created to attach submission data")
        entity = self.created_forms[-1]
        entity.action_id = action_id
        entity.data = form_data or {}
        entity.is_submitted = True
        entity.status_value = HumanInputFormStatus.SUBMITTED
        entity.expiration = naive_utc_now() + timedelta(days=1)

    def clear_submission(self) -> None:
        if not self.created_forms:
            return
        for form in self.created_forms:
            form.action_id = None
            form.data = None
            form.is_submitted = False
            form.status_value = HumanInputFormStatus.WAITING
