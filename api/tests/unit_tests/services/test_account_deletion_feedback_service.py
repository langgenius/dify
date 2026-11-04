from pytest_mock import MockerFixture

from services.account.adapters import BillingAccountDeletionFeedbackGateway
from services.account_deletion_feedback_service import AccountDeletionFeedbackService
from services.billing_service import BillingService


def test_submit_delegates_to_billing_gateway(mocker: MockerFixture) -> None:
    submit = mocker.patch.object(BillingService, "update_account_deletion_feedback")
    service = AccountDeletionFeedbackService(feedback=BillingAccountDeletionFeedbackGateway())

    service.submit(email="account@example.com", feedback="No longer needed")

    submit.assert_called_once_with("account@example.com", "No longer needed")
