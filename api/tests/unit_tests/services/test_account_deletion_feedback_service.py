from unittest.mock import Mock

from services.account_deletion_feedback_service import AccountDeletionFeedbackGateway, AccountDeletionFeedbackService


def test_submit_delegates_to_billing_gateway() -> None:
    feedback = Mock(spec=AccountDeletionFeedbackGateway)
    service = AccountDeletionFeedbackService(feedback=feedback)

    service.submit(email="account@example.com", feedback="No longer needed")

    feedback.submit.assert_called_once_with(email="account@example.com", feedback="No longer needed")
