"""
Admin API endpoints for managing LDAP / Active Directory settings.

Routes:
  GET  /console/api/admin/ldap-settings        – retrieve current config
  POST /console/api/admin/ldap-settings        – save / update config
  POST /console/api/admin/ldap-settings/test   – test connection
"""
from __future__ import annotations

import logging

from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy import select

from extensions.ext_database import db
from libs.ldap import LDAPAuth, decrypt_ldap_password, encrypt_ldap_password
from libs.login import login_required
from models.account import Account
from models.ldap_setting import LdapSetting

from . import console_ns
from .wraps import is_admin_or_owner_required, setup_required, with_current_user

logger = logging.getLogger(__name__)


class LdapSettingsPayload(BaseModel):
    enabled: bool = Field(default=False)
    server_host: str = Field(default="")
    server_port: int = Field(default=389)
    use_ssl: bool = Field(default=False)
    bind_dn: str = Field(default="")
    bind_password: str | None = Field(default=None)
    user_search_base: str = Field(default="")
    user_search_filter: str = Field(default="")
    mail_attribute: str = Field(default="mail")
    name_attribute: str = Field(default="displayName")
    fallback_to_local: bool = Field(default=True)


_MASK = "******"

_DEFAULTS: dict = {
    "enabled": False,
    "server_host": "",
    "server_port": 389,
    "use_ssl": False,
    "bind_dn": "",
    "bind_password": None,
    "user_search_base": "",
    "user_search_filter": "",
    "mail_attribute": "mail",
    "name_attribute": "displayName",
    "fallback_to_local": True,
}


def _setting_to_dict(s: LdapSetting) -> dict:
    return {
        "enabled": s.enabled,
        "server_host": s.server_host,
        "server_port": s.server_port,
        "use_ssl": s.use_ssl,
        "bind_dn": s.bind_dn,
        "bind_password": _MASK if s.bind_password else None,
        "user_search_base": s.user_search_base,
        "user_search_filter": s.user_search_filter,
        "mail_attribute": s.mail_attribute,
        "name_attribute": s.name_attribute,
        "fallback_to_local": s.fallback_to_local,
    }


@console_ns.route("/admin/ldap-settings")
class LdapSettingsApi(Resource):
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @with_current_user
    def get(self, account: Account):
        """Retrieve LDAP configuration settings."""
        row = db.session.scalar(select(LdapSetting).limit(1))
        return _setting_to_dict(row) if row else _DEFAULTS

    @setup_required
    @login_required
    @is_admin_or_owner_required
    @with_current_user
    def post(self, account: Account):
        """Save or update LDAP configuration settings."""
        args = LdapSettingsPayload.model_validate(console_ns.payload)
        session = db.session

        row = session.scalar(select(LdapSetting).limit(1))
        is_new = row is None
        if is_new:
            row = LdapSetting()

        row.enabled = args.enabled
        row.server_host = args.server_host
        row.server_port = args.server_port
        row.use_ssl = args.use_ssl
        row.bind_dn = args.bind_dn
        row.user_search_base = args.user_search_base
        row.user_search_filter = args.user_search_filter
        row.mail_attribute = args.mail_attribute
        row.name_attribute = args.name_attribute
        row.fallback_to_local = args.fallback_to_local

        # Keep existing password if caller sends back the mask or nothing
        if args.bind_password and args.bind_password != _MASK:
            row.bind_password = encrypt_ldap_password(args.bind_password)
        elif is_new:
            row.bind_password = ""

        if is_new:
            session.add(row)
        session.commit()
        return {"result": "success"}


@console_ns.route("/admin/ldap-settings/test")
class LdapSettingsTestApi(Resource):
    @setup_required
    @login_required
    @is_admin_or_owner_required
    @with_current_user
    def post(self, account: Account):
        """Test LDAP connection with the provided or existing settings."""
        args = LdapSettingsPayload.model_validate(console_ns.payload)
        session = db.session

        bind_pw = args.bind_password
        if not bind_pw or bind_pw == _MASK:
            existing = session.scalar(select(LdapSetting).limit(1))
            bind_pw = decrypt_ldap_password(existing.bind_password) if existing else ""

        ok = LDAPAuth.test_connection(
            server_host=args.server_host,
            server_port=args.server_port,
            use_ssl=args.use_ssl,
            bind_dn=args.bind_dn,
            bind_password=bind_pw,
        )
        return {"result": "success" if ok else "fail"}
