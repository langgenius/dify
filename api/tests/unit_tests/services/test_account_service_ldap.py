import pytest
from unittest.mock import MagicMock, patch
from werkzeug.exceptions import Unauthorized
from models.account import Account, AccountStatus
from models.ldap_setting import LdapSetting
from services.account_service import AccountService
from services.errors.account import AccountLoginError, AccountPasswordError
from sqlalchemy.orm import Session

def test_authenticate_ldap_disabled(db):
    """When LDAP is disabled, authenticate should run the default local authentication."""
    session = MagicMock(spec=Session)
    
    # Mock database returning no LDAP settings (disabled)
    session.scalar.side_effect = [
        None,  # First query: LdapSetting
        None   # Second query: Account (user not found)
    ]

    with pytest.raises(AccountPasswordError):
        AccountService.authenticate("test@example.com", "password", session=session)

@patch("libs.ldap.LDAPAuth.authenticate")
def test_authenticate_ldap_success_user_exists(mock_ldap_auth, db):
    """When LDAP authentication is successful and the user already exists, it should return the existing account."""
    session = MagicMock(spec=Session)
    
    # Mock LDAP Setting
    ldap_setting = LdapSetting(
        enabled=True,
        server_host="ldap.example.com",
        server_port=389,
        bind_dn="cn=admin",
        bind_password="password",
        user_search_base="ou=users",
        fallback_to_local=False
    )
    
    # Mock Existing Account
    existing_account = Account(
        email="ldapuser@example.com",
        name="LDAP User",
        interface_language="en-US",
        timezone="UTC"
    )
    existing_account.status = AccountStatus.ACTIVE

    session.scalar.side_effect = [
        ldap_setting,      # Query 1: LdapSetting
        existing_account   # Query 2: Account
    ]

    # Mock LDAP Auth library returning successfully
    mock_ldap_auth.return_value = {
        "email": "ldapuser@example.com",
        "name": "LDAP User",
        "dn": "cn=ldapuser,ou=users"
    }

    result = AccountService.authenticate("ldapuser@example.com", "secret", session=session)
    
    assert result == existing_account
    mock_ldap_auth.assert_called_once_with("ldapuser@example.com", "secret", ldap_setting)

@patch("libs.ldap.LDAPAuth.authenticate")
@patch("services.account_service.AccountService.create_account_and_tenant")
def test_authenticate_ldap_success_auto_provision(mock_create_acc, mock_ldap_auth, db):
    """When LDAP authentication is successful and user doesn't exist, it should auto-create the account."""
    session = MagicMock(spec=Session)
    
    ldap_setting = LdapSetting(
        enabled=True,
        server_host="ldap.example.com",
        fallback_to_local=False
    )
    
    new_account = Account(
        email="newldapuser@example.com",
        name="New LDAP User",
        interface_language="en-US",
        timezone="UTC"
    )
    new_account.status = AccountStatus.ACTIVE

    session.scalar.side_effect = [
        ldap_setting,  # Query 1: LdapSetting
        None           # Query 2: Account (not found)
    ]

    mock_ldap_auth.return_value = {
        "email": "newldapuser@example.com",
        "name": "New LDAP User",
        "dn": "cn=newldapuser,ou=users"
    }
    
    mock_create_acc.return_value = new_account

    result = AccountService.authenticate("newldapuser@example.com", "secret", session=session)

    assert result == new_account
    mock_create_acc.assert_called_once_with(
        email="newldapuser@example.com",
        name="New LDAP User",
        interface_language="en-US",
        timezone="UTC",
        session=session
    )

@patch("libs.ldap.LDAPAuth.authenticate")
def test_authenticate_ldap_fail_no_fallback(mock_ldap_auth, db):
    """When LDAP auth fails and fallback_to_local is False, it should raise AccountPasswordError immediately."""
    session = MagicMock(spec=Session)
    
    ldap_setting = LdapSetting(
        enabled=True,
        server_host="ldap.example.com",
        fallback_to_local=False
    )

    session.scalar.side_effect = [
        ldap_setting  # Query 1: LdapSetting
    ]

    mock_ldap_auth.return_value = None  # Failed auth

    with pytest.raises(AccountPasswordError):
        AccountService.authenticate("user@example.com", "wrong", session=session)

@patch("libs.ldap.LDAPAuth.authenticate")
@patch("services.account_service.compare_password")
def test_authenticate_ldap_fail_with_fallback(mock_compare_pw, mock_ldap_auth, db):
    """When LDAP auth fails but fallback_to_local is True, it should fall back to database credentials."""
    session = MagicMock(spec=Session)
    
    ldap_setting = LdapSetting(
        enabled=True,
        server_host="ldap.example.com",
        fallback_to_local=True
    )

    local_account = Account(
        email="localuser@example.com",
        name="Local User",
        interface_language="en-US",
        timezone="UTC"
    )
    local_account.status = AccountStatus.ACTIVE
    local_account.password = "localhashedpw"
    local_account.password_salt = "localsalt"

    session.scalar.side_effect = [
        ldap_setting,   # Query 1: LdapSetting
        local_account   # Query 2: Account
    ]

    mock_ldap_auth.return_value = None  # Failed LDAP auth
    mock_compare_pw.return_value = True  # Successful local password check

    result = AccountService.authenticate("localuser@example.com", "localpw", session=session)

    assert result == local_account
    mock_compare_pw.assert_called_once_with("localpw", "localhashedpw", "localsalt")
