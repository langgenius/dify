"""
Email Authentication Service for Dify.

This module provides case-insensitive email authentication and validation
utilities for user login, registration, and account management.

Key Features:
- Case-insensitive email matching for login
- Email format validation and normalization
- Domain validation and blocking
- Email verification token management
- Rate limiting for email operations
- Disposable email detection

Related Issue: #17313 - Case insensitive email login
"""

import hashlib
import re
import secrets
import time
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class EmailValidationError(Exception):
    """Exception raised for email validation errors."""

    def __init__(self, message: str, error_code: str = "INVALID_EMAIL"):
        self.message = message
        self.error_code = error_code
        super().__init__(self.message)


class EmailStatus(StrEnum):
    """Status of email validation."""

    VALID = "valid"
    INVALID_FORMAT = "invalid_format"
    DISPOSABLE = "disposable"
    BLOCKED_DOMAIN = "blocked_domain"
    ALREADY_EXISTS = "already_exists"
    NOT_FOUND = "not_found"


@dataclass
class EmailValidationResult:
    """Result of email validation."""

    status: EmailStatus
    normalized_email: str
    original_email: str
    domain: str
    local_part: str
    is_valid: bool
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "status": self.status.value,
            "normalized_email": self.normalized_email,
            "original_email": self.original_email,
            "domain": self.domain,
            "local_part": self.local_part,
            "is_valid": self.is_valid,
            "errors": self.errors,
        }


@dataclass
class EmailVerificationToken:
    """Token for email verification."""

    token: str
    email: str
    created_at: float
    expires_at: float
    purpose: str
    used: bool = False

    def is_expired(self) -> bool:
        """Check if token is expired."""
        return time.time() > self.expires_at

    def is_valid(self) -> bool:
        """Check if token is valid for use."""
        return not self.used and not self.is_expired()


class EmailConfig(BaseModel):
    """Configuration for email authentication."""

    case_sensitive: bool = False
    normalize_gmail_dots: bool = True
    normalize_plus_addressing: bool = True
    block_disposable_emails: bool = True
    allowed_domains: list[str] = Field(default_factory=list)
    blocked_domains: list[str] = Field(default_factory=list)
    max_email_length: int = Field(default=254, ge=10, le=320)
    verification_token_expiry: int = Field(default=3600, ge=300, le=86400)
    max_verification_attempts: int = Field(default=5, ge=1, le=20)

    @field_validator("allowed_domains", "blocked_domains", mode="before")
    @classmethod
    def lowercase_domains(cls, v: list[str]) -> list[str]:
        """Ensure domains are lowercase."""
        return [d.lower() for d in v] if v else []


class EmailAuthService:
    """
    Service for email authentication with case-insensitive matching.

    This service provides comprehensive email handling including validation,
    normalization, and case-insensitive matching for authentication.
    """

    # Common disposable email domains
    DISPOSABLE_DOMAINS = frozenset(
        [
            "tempmail.com",
            "throwaway.email",
            "guerrillamail.com",
            "10minutemail.com",
            "mailinator.com",
            "temp-mail.org",
            "fakeinbox.com",
            "trashmail.com",
            "getnada.com",
            "mohmal.com",
            "tempail.com",
            "dispostable.com",
            "mailnesia.com",
            "tempr.email",
            "discard.email",
            "sharklasers.com",
            "yopmail.com",
            "maildrop.cc",
            "getairmail.com",
            "mintemail.com",
        ]
    )

    # Email regex pattern (RFC 5322 simplified)
    EMAIL_PATTERN = re.compile(
        r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}"
        r"[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$"
    )

    def __init__(self, config: EmailConfig | None = None):
        self.config = config or EmailConfig()
        self._verification_tokens: dict[str, EmailVerificationToken] = {}
        self._rate_limits: dict[str, list[float]] = {}

    def validate_email(self, email: str) -> EmailValidationResult:
        """
        Validate and normalize an email address.

        Args:
            email: The email address to validate

        Returns:
            EmailValidationResult with validation details
        """
        original_email = email.strip()
        errors: list[str] = []

        # Check length
        if len(original_email) > self.config.max_email_length:
            return EmailValidationResult(
                status=EmailStatus.INVALID_FORMAT,
                normalized_email="",
                original_email=original_email,
                domain="",
                local_part="",
                is_valid=False,
                errors=[f"Email exceeds maximum length of {self.config.max_email_length}"],
            )

        # Check format
        if not self.EMAIL_PATTERN.match(original_email):
            return EmailValidationResult(
                status=EmailStatus.INVALID_FORMAT,
                normalized_email="",
                original_email=original_email,
                domain="",
                local_part="",
                is_valid=False,
                errors=["Invalid email format"],
            )

        # Split email
        try:
            local_part, domain = original_email.rsplit("@", 1)
        except ValueError:
            return EmailValidationResult(
                status=EmailStatus.INVALID_FORMAT,
                normalized_email="",
                original_email=original_email,
                domain="",
                local_part="",
                is_valid=False,
                errors=["Invalid email format - missing @ symbol"],
            )

        # Normalize
        normalized_local = local_part
        normalized_domain = domain.lower()

        if not self.config.case_sensitive:
            normalized_local = local_part.lower()

        # Gmail-specific normalization
        if self.config.normalize_gmail_dots and normalized_domain in ("gmail.com", "googlemail.com"):
            normalized_local = normalized_local.replace(".", "")

        # Plus addressing normalization
        if self.config.normalize_plus_addressing and "+" in normalized_local:
            normalized_local = normalized_local.split("+")[0]

        normalized_email = f"{normalized_local}@{normalized_domain}"

        # Check disposable domains
        if self.config.block_disposable_emails and normalized_domain in self.DISPOSABLE_DOMAINS:
            return EmailValidationResult(
                status=EmailStatus.DISPOSABLE,
                normalized_email=normalized_email,
                original_email=original_email,
                domain=normalized_domain,
                local_part=normalized_local,
                is_valid=False,
                errors=["Disposable email addresses are not allowed"],
            )

        # Check blocked domains
        if normalized_domain in self.config.blocked_domains:
            return EmailValidationResult(
                status=EmailStatus.BLOCKED_DOMAIN,
                normalized_email=normalized_email,
                original_email=original_email,
                domain=normalized_domain,
                local_part=normalized_local,
                is_valid=False,
                errors=["This email domain is not allowed"],
            )

        # Check allowed domains (if configured)
        if self.config.allowed_domains and normalized_domain not in self.config.allowed_domains:
            return EmailValidationResult(
                status=EmailStatus.BLOCKED_DOMAIN,
                normalized_email=normalized_email,
                original_email=original_email,
                domain=normalized_domain,
                local_part=normalized_local,
                is_valid=False,
                errors=["This email domain is not in the allowed list"],
            )

        return EmailValidationResult(
            status=EmailStatus.VALID,
            normalized_email=normalized_email,
            original_email=original_email,
            domain=normalized_domain,
            local_part=normalized_local,
            is_valid=True,
            errors=[],
        )

    def normalize_email(self, email: str) -> str:
        """
        Normalize an email address for consistent storage and lookup.

        Args:
            email: The email to normalize

        Returns:
            Normalized email string

        Raises:
            EmailValidationError: If email is invalid
        """
        result = self.validate_email(email)
        if not result.is_valid:
            raise EmailValidationError(
                message=result.errors[0] if result.errors else "Invalid email",
                error_code=result.status.value,
            )
        return result.normalized_email

    def emails_match(self, email1: str, email2: str) -> bool:
        """
        Check if two emails match (case-insensitive comparison).

        Args:
            email1: First email address
            email2: Second email address

        Returns:
            True if emails match after normalization
        """
        try:
            normalized1 = self.normalize_email(email1)
            normalized2 = self.normalize_email(email2)
            return normalized1 == normalized2
        except EmailValidationError:
            return False

    def generate_verification_token(
        self,
        email: str,
        purpose: str = "verification",
    ) -> EmailVerificationToken:
        """
        Generate a verification token for an email.

        Args:
            email: The email address
            purpose: The purpose of the token (e.g., 'verification', 'reset')

        Returns:
            EmailVerificationToken instance
        """
        normalized = self.normalize_email(email)
        token = secrets.token_urlsafe(32)
        now = time.time()

        verification = EmailVerificationToken(
            token=token,
            email=normalized,
            created_at=now,
            expires_at=now + self.config.verification_token_expiry,
            purpose=purpose,
        )

        # Store token
        token_key = self._get_token_key(token)
        self._verification_tokens[token_key] = verification

        return verification

    def verify_token(self, token: str, email: str, purpose: str = "verification") -> bool:
        """
        Verify an email verification token.

        Args:
            token: The verification token
            email: The email address to verify
            purpose: Expected purpose of the token

        Returns:
            True if token is valid
        """
        token_key = self._get_token_key(token)
        verification = self._verification_tokens.get(token_key)

        if not verification:
            return False

        if not verification.is_valid():
            return False

        if verification.purpose != purpose:
            return False

        try:
            normalized = self.normalize_email(email)
            if verification.email != normalized:
                return False
        except EmailValidationError:
            return False

        # Mark as used
        verification.used = True
        return True

    def invalidate_token(self, token: str) -> bool:
        """Invalidate a verification token."""
        token_key = self._get_token_key(token)
        if token_key in self._verification_tokens:
            del self._verification_tokens[token_key]
            return True
        return False

    def cleanup_expired_tokens(self) -> int:
        """Remove expired tokens and return count of removed tokens."""
        now = time.time()
        expired_keys = [
            key for key, token in self._verification_tokens.items() if token.expires_at < now
        ]
        for key in expired_keys:
            del self._verification_tokens[key]
        return len(expired_keys)

    def check_rate_limit(self, email: str, window_seconds: int = 3600, max_attempts: int = 5) -> bool:
        """
        Check if email operations are rate limited.

        Args:
            email: The email to check
            window_seconds: Time window for rate limiting
            max_attempts: Maximum attempts in window

        Returns:
            True if within rate limit, False if exceeded
        """
        try:
            normalized = self.normalize_email(email)
        except EmailValidationError:
            return False

        now = time.time()
        key = self._get_rate_limit_key(normalized)

        # Get or create rate limit entry
        if key not in self._rate_limits:
            self._rate_limits[key] = []

        # Clean old entries
        self._rate_limits[key] = [t for t in self._rate_limits[key] if now - t < window_seconds]

        # Check limit
        if len(self._rate_limits[key]) >= max_attempts:
            return False

        # Record attempt
        self._rate_limits[key].append(now)
        return True

    def get_rate_limit_remaining(
        self, email: str, window_seconds: int = 3600, max_attempts: int = 5
    ) -> int:
        """Get remaining attempts before rate limit."""
        try:
            normalized = self.normalize_email(email)
        except EmailValidationError:
            return 0

        now = time.time()
        key = self._get_rate_limit_key(normalized)

        if key not in self._rate_limits:
            return max_attempts

        recent = [t for t in self._rate_limits[key] if now - t < window_seconds]
        return max(0, max_attempts - len(recent))

    def _get_token_key(self, token: str) -> str:
        """Generate storage key for token."""
        return hashlib.sha256(token.encode()).hexdigest()

    def _get_rate_limit_key(self, email: str) -> str:
        """Generate storage key for rate limiting."""
        return hashlib.sha256(email.encode()).hexdigest()

    @classmethod
    def create_for_enterprise(cls, allowed_domains: list[str]) -> "EmailAuthService":
        """Create service configured for enterprise use."""
        config = EmailConfig(
            case_sensitive=False,
            block_disposable_emails=True,
            allowed_domains=allowed_domains,
            max_verification_attempts=10,
        )
        return cls(config=config)

    @classmethod
    def create_for_public(cls) -> "EmailAuthService":
        """Create service configured for public use."""
        config = EmailConfig(
            case_sensitive=False,
            block_disposable_emails=True,
            normalize_gmail_dots=True,
            normalize_plus_addressing=True,
        )
        return cls(config=config)

    def get_email_hash(self, email: str) -> str:
        """Get a hash of the normalized email for lookups."""
        normalized = self.normalize_email(email)
        return hashlib.sha256(normalized.encode()).hexdigest()

    def extract_domain(self, email: str) -> str:
        """Extract and normalize the domain from an email."""
        result = self.validate_email(email)
        return result.domain

    def is_corporate_email(self, email: str) -> bool:
        """Check if email appears to be from a corporate domain."""
        common_personal_domains = {
            "gmail.com",
            "yahoo.com",
            "hotmail.com",
            "outlook.com",
            "live.com",
            "icloud.com",
            "aol.com",
            "protonmail.com",
            "mail.com",
            "zoho.com",
        }
        result = self.validate_email(email)
        return result.is_valid and result.domain not in common_personal_domains
