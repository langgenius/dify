from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from core.workflow.nodes.human_input.entities import FormInput
from core.workflow.nodes.human_input.enums import TimeoutUnit


# Exceptions
class HumanInputError(Exception):
    error_code: str = "unknown"

    def __init__(self, message: str = "", error_code: str | None = None):
        super().__init__(message)
        self.message = message or self.__class__.__name__
        if error_code:
            self.error_code = error_code


class FormNotFoundError(HumanInputError):
    error_code = "form_not_found"


class FormExpiredError(HumanInputError):
    error_code = "human_input_form_expired"


class FormAlreadySubmittedError(HumanInputError):
    error_code = "human_input_form_submitted"


class InvalidFormDataError(HumanInputError):
    error_code = "invalid_form_data"


# Models
@dataclass
class HumanInputForm:
    form_id: str
    workflow_run_id: str
    node_id: str
    tenant_id: str
    app_id: str | None
    form_content: str
    inputs: list[FormInput]
    user_actions: list[dict[str, Any]]
    timeout: int
    timeout_unit: TimeoutUnit
    form_token: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    expires_at: datetime | None = None
    submitted_at: datetime | None = None
    submitted_data: dict[str, Any] | None = None
    submitted_action: str | None = None

    def __post_init__(self) -> None:
        if self.expires_at is None:
            self.calculate_expiration()

    @property
    def is_expired(self) -> bool:
        return self.expires_at is not None and datetime.utcnow() > self.expires_at

    @property
    def is_submitted(self) -> bool:
        return self.submitted_at is not None

    def mark_submitted(self, inputs: dict[str, Any], action: str) -> None:
        self.submitted_data = inputs
        self.submitted_action = action
        self.submitted_at = datetime.utcnow()

    def submit(self, inputs: dict[str, Any], action: str) -> None:
        self.mark_submitted(inputs, action)

    def calculate_expiration(self) -> None:
        start = self.created_at
        if self.timeout_unit == TimeoutUnit.HOUR:
            self.expires_at = start + timedelta(hours=self.timeout)
        elif self.timeout_unit == TimeoutUnit.DAY:
            self.expires_at = start + timedelta(days=self.timeout)
        else:
            raise ValueError(f"Unsupported timeout unit {self.timeout_unit}")

    def to_response_dict(self, *, include_site_info: bool) -> dict[str, Any]:
        inputs_response = [
            {
                "type": form_input.type.name.lower().replace("_", "-"),
                "output_variable_name": form_input.output_variable_name,
            }
            for form_input in self.inputs
        ]
        response = {
            "form_content": self.form_content,
            "inputs": inputs_response,
            "user_actions": self.user_actions,
        }
        if include_site_info:
            response["site"] = {"app_id": self.app_id, "title": "Workflow Form"}
        return response


@dataclass
class FormSubmissionData:
    form_id: str
    inputs: dict[str, Any]
    action: str
    submitted_at: datetime = field(default_factory=datetime.utcnow)

    @classmethod
    def from_request(cls, form_id: str, request: FormSubmissionRequest) -> FormSubmissionData:  # type: ignore
        return cls(form_id=form_id, inputs=request.inputs, action=request.action)


@dataclass
class FormSubmissionRequest:
    inputs: dict[str, Any]
    action: str


# Repository
class InMemoryFormRepository:
    """
    Simple in-memory repository used by unit tests.
    """

    def __init__(self):
        self._forms: dict[str, HumanInputForm] = {}

    @property
    def forms(self) -> dict[str, HumanInputForm]:
        return self._forms

    def save(self, form: HumanInputForm) -> None:
        self._forms[form.form_id] = form

    def get_by_id(self, form_id: str) -> HumanInputForm | None:
        return self._forms.get(form_id)

    def get_by_token(self, token: str) -> HumanInputForm | None:
        for form in self._forms.values():
            if form.form_token == token:
                return form
        return None

    def delete(self, form_id: str) -> None:
        self._forms.pop(form_id, None)


# Service
class FormService:
    """Service layer for managing human input forms in tests."""

    def __init__(self, repository: InMemoryFormRepository):
        self.repository = repository

    def create_form(
        self,
        *,
        form_id: str,
        workflow_run_id: str,
        node_id: str,
        tenant_id: str,
        app_id: str | None,
        form_content: str,
        inputs,
        user_actions,
        timeout: int,
        timeout_unit: TimeoutUnit,
        form_token: str | None = None,
    ) -> HumanInputForm:
        form = HumanInputForm(
            form_id=form_id,
            workflow_run_id=workflow_run_id,
            node_id=node_id,
            tenant_id=tenant_id,
            app_id=app_id,
            form_content=form_content,
            inputs=list(inputs),
            user_actions=[{"id": action.id, "title": action.title} for action in user_actions],
            timeout=timeout,
            timeout_unit=timeout_unit,
            form_token=form_token,
        )
        form.calculate_expiration()
        self.repository.save(form)
        return form

    def get_form_by_id(self, form_id: str) -> HumanInputForm:
        form = self.repository.get_by_id(form_id)
        if form is None:
            raise FormNotFoundError()
        return form

    def get_form_by_token(self, token: str) -> HumanInputForm:
        form = self.repository.get_by_token(token)
        if form is None:
            raise FormNotFoundError()
        return form

    def get_form_definition(self, form_id: str, *, is_token: bool) -> dict:
        form = self.get_form_by_token(form_id) if is_token else self.get_form_by_id(form_id)
        if form.is_expired:
            raise FormExpiredError()
        if form.is_submitted:
            raise FormAlreadySubmittedError()

        definition = {
            "form_content": form.form_content,
            "inputs": form.inputs,
            "user_actions": form.user_actions,
        }
        if is_token:
            definition["site"] = {"title": "Workflow Form"}
        return definition

    def submit_form(self, form_id: str, submission_data: FormSubmissionData, *, is_token: bool) -> None:
        form = self.get_form_by_token(form_id) if is_token else self.get_form_by_id(form_id)
        if form.is_expired:
            raise FormExpiredError()
        if form.is_submitted:
            raise FormAlreadySubmittedError()

        self._validate_submission(form=form, submission_data=submission_data)
        form.mark_submitted(inputs=submission_data.inputs, action=submission_data.action)
        self.repository.save(form)

    def cleanup_expired_forms(self) -> int:
        expired_ids = [form_id for form_id, form in list(self.repository.forms.items()) if form.is_expired]
        for form_id in expired_ids:
            self.repository.delete(form_id)
        return len(expired_ids)

    def _validate_submission(self, form: HumanInputForm, submission_data: FormSubmissionData) -> None:
        defined_actions = {action["id"] for action in form.user_actions}
        if submission_data.action not in defined_actions:
            raise InvalidFormDataError(f"Invalid action: {submission_data.action}")

        missing_inputs = []
        for form_input in form.inputs:
            if form_input.output_variable_name not in submission_data.inputs:
                missing_inputs.append(form_input.output_variable_name)

        if missing_inputs:
            raise InvalidFormDataError(f"Missing required inputs: {', '.join(missing_inputs)}")

        # Extra inputs are allowed; no further validation required.
