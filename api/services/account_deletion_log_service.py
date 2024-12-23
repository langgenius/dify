
from datetime import timedelta

from configs import dify_config
from extensions.ext_database import db
from flask import jsonify
from libs.helper import get_current_datetime
from models.account import Account, AccountDeletionLog


class AccountDeletionLogService:
    @staticmethod
    def create_account_deletion_log(account: Account, reason):
        account_deletion_log = AccountDeletionLog()
        account_deletion_log.email = account.email
        account_deletion_log.reason = reason
        account_deletion_log.account_id = account.id
        account_deletion_log.snapshot = jsonify(account)
        account_deletion_log.updated_at = get_current_datetime()

        return account_deletion_log

    @staticmethod
    def email_in_freeze(email):
        log = db.session.query(AccountDeletionLog) \
            .filter(AccountDeletionLog.email == email) \
            .order_by(AccountDeletionLog.created_at.desc()) \
            .first()

        if not log:
            return False

        # check if email is in freeze
        if log.created_at + timedelta(days=dify_config.EMAIL_FREEZE_PERIOD_IN_DAYS) > get_current_datetime():
            return True
        return False
