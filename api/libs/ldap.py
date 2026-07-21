"""
LDAP / Active Directory authentication helper for Dify.

Provides:
  - LDAPAuth.authenticate()      – two-phase bind: reader search + user credential bind
  - LDAPAuth.test_connection()   – service-account reachability check
  - encrypt_ldap_password()      – AES-Fernet encryption using Dify's SECRET_KEY
  - decrypt_ldap_password()      – inverse of the above
"""
from __future__ import annotations

import base64
import hashlib
import logging
import ssl

from cryptography.fernet import Fernet
from ldap3 import ALL, SUBTREE, Connection, Server, Tls

from configs import dify_config

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Password encryption helpers
# ---------------------------------------------------------------------------

def _get_fernet_key() -> bytes:
    """Derive a 32-byte Fernet key from Dify's SECRET_KEY."""
    secret = dify_config.SECRET_KEY or "fallback-secret-key-for-ldap-obfuscation"
    digest = hashlib.sha256(secret.encode()).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_ldap_password(password: str) -> str:
    """Encrypt an LDAP bind password for safe storage in the database."""
    if not password:
        return ""
    try:
        return Fernet(_get_fernet_key()).encrypt(password.encode()).decode()
    except Exception:
        logger.exception("Failed to encrypt LDAP password")
        return password


def decrypt_ldap_password(encrypted: str) -> str:
    """Decrypt an LDAP bind password previously stored by encrypt_ldap_password."""
    if not encrypted:
        return ""
    try:
        return Fernet(_get_fernet_key()).decrypt(encrypted.encode()).decode()
    except Exception:
        logger.exception("Failed to decrypt LDAP password – returning raw value")
        return encrypted


# ---------------------------------------------------------------------------
# LDAP / AD authentication
# ---------------------------------------------------------------------------

class LDAPAuth:
    """Stateless helper that authenticates users against an LDAP / AD directory."""

    @staticmethod
    def _make_server(host: str, port: int, use_ssl: bool) -> Server:
        tls_config: Tls | None = None
        if use_ssl:
            # Use a permissive TLS context – common in corporate self-signed AD setups.
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            tls_config = Tls(ssl_context=ctx)
        return Server(host=host, port=port, use_ssl=use_ssl, tls=tls_config, get_info=ALL)

    @staticmethod
    def test_connection(
        server_host: str,
        server_port: int,
        use_ssl: bool,
        bind_dn: str,
        bind_password: str,
    ) -> bool:
        """Return True if the service account can bind to the LDAP server."""
        try:
            server = LDAPAuth._make_server(server_host, server_port, use_ssl)
            logger.info("Testing LDAP bind: %s at %s:%s", bind_dn, server_host, server_port)
            conn = Connection(server, user=bind_dn, password=bind_password, auto_bind=True)
            conn.unbind()
            return True
        except Exception:
            logger.exception("LDAP connection test failed")
            return False

    @staticmethod
    def authenticate(username: str, password: str, ldap_setting) -> dict | None:
        """
        Two-phase LDAP authentication:

        1. Bind with the configured service (reader) account.
        2. Search the directory for *username* using the configured filter.
        3. Re-bind as the located user DN to validate *password*.

        Returns a dict ``{"email": ..., "name": ..., "dn": ...}`` on success,
        or *None* on failure.
        """
        if not ldap_setting or not ldap_setting.enabled:
            return None

        bind_password = decrypt_ldap_password(ldap_setting.bind_password)
        server = LDAPAuth._make_server(
            ldap_setting.server_host, ldap_setting.server_port, ldap_setting.use_ssl
        )

        try:
            # Phase 1 – service bind
            conn = Connection(server, user=ldap_setting.bind_dn, password=bind_password, auto_bind=True)

            # Phase 2 – locate the user
            search_filter = ldap_setting.user_search_filter.replace("{username}", username)
            mail_attr = ldap_setting.mail_attribute
            name_attr = ldap_setting.name_attribute

            logger.info(
                "LDAP search | filter: %s | base: %s", search_filter, ldap_setting.user_search_base
            )
            conn.search(
                search_base=ldap_setting.user_search_base,
                search_filter=search_filter,
                search_scope=SUBTREE,
                attributes=[mail_attr, name_attr],
            )

            if not conn.entries:
                logger.warning("LDAP user not found: %s", username)
                conn.unbind()
                return None

            entry = conn.entries[0]
            user_dn = entry.entry_dn

            def _attr(name: str) -> str:
                try:
                    val = getattr(entry, name).value
                    return val[0] if isinstance(val, list) else (val or "")
                except Exception:
                    return ""

            email = _attr(mail_attr)
            name = _attr(name_attr)
            conn.unbind()

            if not email:
                logger.error("LDAP entry %s has no '%s' attribute", user_dn, mail_attr)
                return None

            # Phase 3 – user credential bind
            user_conn = Connection(server, user=user_dn, password=password)
            if user_conn.bind():
                user_conn.unbind()
                logger.info("LDAP authentication successful: %s", user_dn)
                return {"email": email, "name": name or username, "dn": user_dn}

            logger.warning("LDAP credentials invalid for DN: %s | result: %s", user_dn, user_conn.result)
            return None

        except Exception:
            logger.exception("LDAP authentication failed for user: %s", username)
            return None
