from typing import cast

import flask_login
from flask_restx import Resource, reqparse

from controllers.console.wraps import account_initialization_required
from libs.login import login_required
from models.account import Account
from services.mfa_service import MFAService


class MFASetupInitApi(Resource):
    @login_required
    @account_initialization_required
    def get(self):
        """Initialize MFA setup - generate secret and QR code (GET method for compatibility)."""
        return self.post()

    @login_required
    @account_initialization_required
    def post(self):  # type: ignore
        """Initialize MFA setup - generate secret and QR code."""
        account = cast(Account, flask_login.current_user)

        try:
            mfa_status = MFAService.get_mfa_status(account)
            if mfa_status["enabled"]:
                return {"error": "MFA is already enabled"}, 400

            setup_data = MFAService.generate_mfa_setup_data(account)
            return {"secret": setup_data["secret"], "qr_code": setup_data["qr_code"]}
        except Exception as e:
            return {"error": str(e)}, 500


class MFASetupCompleteApi(Resource):
    @login_required
    @account_initialization_required
    def post(self):
        """Complete MFA setup with TOTP verification."""
        parser = reqparse.RequestParser()
        parser.add_argument("totp_token", type=str, required=True, help="TOTP token is required")
        args = parser.parse_args()

        account = cast(Account, flask_login.current_user)

        try:
            result = MFAService.setup_mfa(account, args["totp_token"])
            return {
                "message": "MFA setup completed successfully",
                "backup_codes": result["backup_codes"],
                "setup_at": result["setup_at"].isoformat(),
            }
        except ValueError as e:
            return {"error": str(e)}, 400
        except Exception as e:
            return {"error": str(e)}, 500


class MFADisableApi(Resource):
    @login_required
    @account_initialization_required
    def post(self):
        """Disable MFA with password verification."""
        parser = reqparse.RequestParser()
        parser.add_argument("password", type=str, required=True, help="Password is required")
        args = parser.parse_args()

        account = cast(Account, flask_login.current_user)

        try:
            mfa_status = MFAService.get_mfa_status(account)
            if not mfa_status["enabled"]:
                return {"error": "MFA is not enabled"}, 400

            if MFAService.disable_mfa(account, args["password"]):
                return {"message": "MFA disabled successfully"}
            else:
                return {"error": "Invalid password"}, 400
        except Exception as e:
            return {"error": str(e)}, 500


class MFAStatusApi(Resource):
    @login_required
    @account_initialization_required
    def get(self):
        """Get current MFA status."""
        account = cast(Account, flask_login.current_user)

        try:
            status = MFAService.get_mfa_status(account)
            return status
        except Exception as e:
            return {"error": str(e)}, 500


class MFAVerifyApi(Resource):
    def post(self):
        """Verify MFA token during login (public endpoint)."""
        parser = reqparse.RequestParser()
        parser.add_argument("email", type=str, required=True, help="Email is required")
        parser.add_argument("mfa_token", type=str, required=True, help="MFA token is required")
        args = parser.parse_args()

        from models.engine import db

        account = db.session.query(Account).filter_by(email=args["email"]).first()

        if not account:
            return {"error": "Account not found"}, 404

        if not MFAService.is_mfa_required(account):
            return {"error": "MFA not required for this account"}, 400

        try:
            if MFAService.authenticate_with_mfa(account, args["mfa_token"]):
                return {"message": "MFA verification successful"}
            else:
                return {"error": "Invalid MFA token"}, 400
        except Exception as e:
            return {"error": str(e)}, 500
