"""Utilities for testing HumanInputNode without database dependencies."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from core.workflow.repositories.human_input_form_repository import (
    FormCreateParams,
    FormSubmission,
    HumanInputFormEntity,
    HumanInputFormRecipientEntity,
    HumanInputFormRepository,
)


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


class _InMemoryFormSubmission(FormSubmission):
    def __init__(self, selected_action_id: str, form_data: Mapping[str, Any]) -> None:
        self._selected_action_id = selected_action_id
        self._form_data = form_data

    @property
    def selected_action_id(self) -> str:
        return self._selected_action_id

    def form_data(self) -> Mapping[str, Any]:
        return self._form_data


class InMemoryHumanInputFormRepository(HumanInputFormRepository):
    """Pure in-memory repository used by workflow graph engine tests."""

    def __init__(self) -> None:
        self._form_counter = 0
        self.created_params: list[FormCreateParams] = []
        self.created_forms: list[_InMemoryFormEntity] = []
        self._forms_by_key: dict[tuple[str, str], _InMemoryFormEntity] = {}
        self._submissions: dict[str, FormSubmission] = {}

    def create_form(self, params: FormCreateParams) -> HumanInputFormEntity:
        self.created_params.append(params)
        self._form_counter += 1
        form_id = f"form-{self._form_counter}"
        entity = _InMemoryFormEntity(form_id=form_id, rendered=params.rendered_content, token=f"token-{form_id}")
        self.created_forms.append(entity)
        self._forms_by_key[(params.workflow_execution_id, params.node_id)] = entity
        return entity

    def get_form(self, workflow_execution_id: str, node_id: str) -> HumanInputFormEntity | None:
        return self._forms_by_key.get((workflow_execution_id, node_id))

    def get_form_submission(self, form_id: str) -> FormSubmission | None:
        return self._submissions.get(form_id)

    # Convenience helpers for tests -------------------------------------

    def set_submission(self, *, action_id: str, form_data: Mapping[str, Any] | None = None) -> None:
        """Simulate a human submission for the next repository lookup."""

        if not self.created_forms:
            raise AssertionError("no form has been created to attach submission data")
        target_form_id = self.created_forms[-1].id
        self._submissions[target_form_id] = _InMemoryFormSubmission(action_id, form_data or {})

    def clear_submission(self) -> None:
        self._submissions.clear()
