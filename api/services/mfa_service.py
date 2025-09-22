import base64
import io
import json
import secrets
from datetime import UTC, datetime

import pyotp
import qrcode

from models.account import Account, AccountMFASettings
from models.engine import db


class MFAService:
    @staticmethod
    def generate_secret() -> str:
        """Generate a new TOTP secret for the user."""
        return pyotp.random_base32()

    @staticmethod
    def generate_backup_codes(count: int = 8) -> list[str]:
        """Generate backup codes for account recovery."""
        codes = []
        for _ in range(count):
            code = secrets.token_hex(4).upper()
            codes.append(code)
        return codes

    @staticmethod
    def generate_qr_code(account: Account, secret: str) -> str:
        """Generate QR code for TOTP setup."""
        totp = pyotp.TOTP(secret)
        provisioning_uri = totp.provisioning_uri(name=account.email, issuer_name="Dify")

        # Generate QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(provisioning_uri)
        qr.make(fit=True)

        # Create image
        img = qr.make_image(fill_color="black", back_color="white")

        # Convert to base64
        buffer = io.BytesIO()
        img.save(buffer)
        img_str = base64.b64encode(buffer.getvalue()).decode()

        return f"data:image/png;base64,{img_str}"

    @staticmethod
    def verify_totp(secret: str, token: str) -> bool:
        """Verify TOTP token."""
        if not secret:
            return False
        try:
            totp = pyotp.TOTP(secret)
            return totp.verify(token, valid_window=1)
        except (ValueError, TypeError) as e:
            import logging
            logging.error(f"TOTP verification failed: {e}")
            return False

    @staticmethod
    def get_or_create_mfa_settings(account: Account) -> AccountMFASettings:
        """Get or create MFA settings for account."""
        mfa_settings = db.session.query(AccountMFASettings).filter_by(account_id=account.id).first()
        if not mfa_settings:
            mfa_settings = AccountMFASettings(account_id=account.id)
            db.session.add(mfa_settings)
            db.session.commit()
        return mfa_settings

    @staticmethod
    def verify_backup_code(mfa_settings: AccountMFASettings, code: str) -> bool:
        """Verify and consume backup code."""
        if not mfa_settings.backup_codes:
            return False

        try:
            backup_codes = json.loads(mfa_settings.backup_codes)
            if code.upper() in backup_codes:
                # Remove used backup code
                backup_codes.remove(code.upper())
                mfa_settings.backup_codes = json.dumps(backup_codes)
                db.session.commit()
                return True
        except json.JSONDecodeError:
            pass

        return False

    @staticmethod
    def setup_mfa(account: Account, totp_token: str) -> dict:
        """Setup MFA for account with TOTP verification."""
        mfa_settings = MFAService.get_or_create_mfa_settings(account)

        if mfa_settings.enabled:
            raise ValueError("MFA is already enabled for this account")

        if not mfa_settings.secret:
            raise ValueError("MFA secret not generated")

        # Verify TOTP token
        if not MFAService.verify_totp(mfa_settings.secret, totp_token):
            raise ValueError("Invalid TOTP token")

        # Generate backup codes
        backup_codes = MFAService.generate_backup_codes()

        # Enable MFA
        mfa_settings.enabled = True
        mfa_settings.backup_codes = json.dumps(backup_codes)
        mfa_settings.setup_at = datetime.now(UTC)

        db.session.commit()

        return {"backup_codes": backup_codes, "setup_at": mfa_settings.setup_at}

    @staticmethod
    def disable_mfa(account: Account, password: str) -> bool:
        """Disable MFA for account after password verification."""
        from libs.password import compare_password

        # Verify password
        if account.password is None or not compare_password(password, account.password, account.password_salt):
            return False

        mfa_settings = db.session.query(AccountMFASettings).filter_by(account_id=account.id).first()
        if not mfa_settings:
            return True  # Already disabled

        # Disable MFA
        mfa_settings.enabled = False
        mfa_settings.secret = None
        mfa_settings.backup_codes = None
        mfa_settings.setup_at = None

        db.session.commit()
        return True

    @staticmethod
    def generate_mfa_setup_data(account: Account) -> dict:
        """Generate MFA setup data including secret and QR code."""
        mfa_settings = MFAService.get_or_create_mfa_settings(account)

        if mfa_settings.enabled:
            raise ValueError("MFA is already enabled for this account")

        # Generate new secret
        secret = MFAService.generate_secret()
        mfa_settings.secret = secret
        db.session.commit()

        # Generate QR code
        qr_code = MFAService.generate_qr_code(account, secret)

        return {"secret": secret, "qr_code": qr_code}

    @staticmethod
    def is_mfa_required(account: Account) -> bool:
        """Check if MFA is required for this account."""
        mfa_settings = db.session.query(AccountMFASettings).filter_by(account_id=account.id).first()
        return bool(mfa_settings and mfa_settings.enabled and mfa_settings.secret is not None)

    @staticmethod
    def authenticate_with_mfa(account: Account, token: str) -> bool:
        """Authenticate user with MFA token (TOTP or backup code)."""
        mfa_settings = db.session.query(AccountMFASettings).filter_by(account_id=account.id).first()

        if not mfa_settings or not mfa_settings.enabled:
            return True

        # Try TOTP first
        if MFAService.verify_totp(mfa_settings.secret, token):
            return True

        # Try backup code
        if MFAService.verify_backup_code(mfa_settings, token):
            return True

        return False

    @staticmethod
    def get_mfa_status(account: Account) -> dict:
        """Get MFA status for account."""
        mfa_settings = db.session.query(AccountMFASettings).filter_by(account_id=account.id).first()

        if not mfa_settings:
            return {"enabled": False, "setup_at": None, "has_backup_codes": False}

        return {
            "enabled": mfa_settings.enabled,
            "setup_at": mfa_settings.setup_at.isoformat() if mfa_settings.setup_at else None,
            "has_backup_codes": mfa_settings.backup_codes is not None,
        }
