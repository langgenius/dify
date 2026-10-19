from unittest.mock import MagicMock

from services.entities.mail_entities import InnerMailMessage
from services.inner_mail_service import InnerMailService


def test_inner_mail_service_delegates_to_dispatcher() -> None:
    dispatch = MagicMock()
    service = InnerMailService(dispatch=dispatch)
    message = InnerMailMessage(recipients=("one@example.com",), subject="Subject", body="Body")

    service.send(message)

    dispatch.assert_called_once_with(message)
