
from typing import Dict, List

from pydantic import BaseModel

from tasks.mail_enterprise_task import send_enterprise_email_task


class DifyMail(BaseModel):
    to: List[str]
    subject: str
    body: str
    substitutions: Dict[str, str] = {}


class EnterpriseMailService:

    @classmethod
    def send_mail(cls, mail: DifyMail):

        send_enterprise_email_task.delay(
            to=mail.to,
            subject=mail.subject,
            body=mail.body,
            substitutions=mail.substitutions
        )
