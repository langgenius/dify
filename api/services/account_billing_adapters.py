"""Billing adapters for account education and deletion-feedback use cases."""

from datetime import UTC, datetime
from typing import override

from services.account_deletion_feedback_service import AccountDeletionFeedbackGateway
from services.account_education_service import AccountEducationGateway
from services.billing_service import BillingService
from services.entities.account_entities import (
    AccountEducationActivation,
    AccountEducationAutocomplete,
    AccountEducationStatus,
    AccountEducationVerification,
)


class BillingAccountEducationGateway(AccountEducationGateway):
    @override
    def verify(self, *, account_id: str) -> AccountEducationVerification:
        result = BillingService.EducationIdentity.verify(account_id=account_id) or {}
        return AccountEducationVerification(token=result.get("token"))

    @override
    def activate(
        self,
        *,
        account_id: str,
        tenant_id: str,
        token: str,
        institution: str,
        role: str,
    ) -> AccountEducationActivation:
        result = BillingService.EducationIdentity.activate(
            account_id=account_id,
            tenant_id=tenant_id,
            token=token,
            institution=institution,
            role=role,
        )
        return AccountEducationActivation(message=result["message"])

    @override
    def status(self, account_id: str) -> AccountEducationStatus:
        result = BillingService.EducationIdentity.status(account_id) or {}
        expire_at = result.get("expire_at")
        return AccountEducationStatus(
            result=result.get("result"),
            is_student=result.get("is_student"),
            expire_at=datetime.fromisoformat(expire_at).astimezone(UTC) if isinstance(expire_at, str) else expire_at,
            allow_refresh=result.get("allow_refresh"),
        )

    @override
    def autocomplete(self, *, keywords: str, page: int, limit: int) -> AccountEducationAutocomplete:
        result = BillingService.EducationIdentity.autocomplete(keywords, page, limit) or {}
        return AccountEducationAutocomplete(
            data=tuple(result.get("data") or ()),
            curr_page=result.get("curr_page"),
            has_next=result.get("has_next"),
        )


class BillingAccountDeletionFeedbackGateway(AccountDeletionFeedbackGateway):
    @override
    def submit(self, *, email: str, feedback: str) -> None:
        BillingService.update_account_deletion_feedback(email, feedback)
