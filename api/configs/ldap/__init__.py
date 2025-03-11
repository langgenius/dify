# -*- coding: utf-8 -*-
"""
@File    : __init__.py.py 
@Time    : 2025/3/6 {TIME}
@Author  : xxlaila
@Software: dify
"""
from pydantic import Field
from pydantic_settings import BaseSettings

class AuthenticationConfig(BaseSettings):
    """LDAP authentication related configuration"""
    # LDAP Authentication
    LDAP_ENABLED: bool = Field(
        False,
        description="Whether to enable LDAP authentication",
        validation_alias="LDAP_ENABLED"
    )
    AUTH_LDAP_SERVER_URI: str = Field(
        "ldap://localhost",
        description="LDAP server address",
        validation_alias="AUTH_LDAP_SERVER_URI"
    )
    AUTH_LDAP_BIND_DN: str = Field(
        "cn=admin,dc=example,dc=com",
        description="LDAP Bind DN",
        validation_alias="AUTH_LDAP_BIND_DN"
    )
    AUTH_LDAP_BIND_PASSWORD: str = Field(
        "<PASSWORD>",
        description="LDAP bind password",
        validation_alias="AUTH_LDAP_BIND_PASSWORD"
    )
    AUTH_LDAP_SEARCH_BASE_DN: str = Field(
        default="OU=Limited Company,DC=example,DC=com",
        description="LDAP search base DN",
        validation_alias="AUTH_LDAP_SEARCH_BASE_DN"
    )
    AUTH_LDAP_USER_FILTER: str = Field(
        "(objectClass=person)",
        description="LDAP User Filter",
        validation_alias="AUTH_LDAP_USER_FILTER"
    )
    AUTH_LDAP_USER_ATTR_MAP: dict = Field(
        {"first_name": "uid", "last_name": "cn", "email": "mail"},
        description="Mapping of LDAP attributes to user models",
        validation_alias="AUTH_LDAP_USER_ATTR_MAP"
    )
    CACHE_LDAP_USER_KEY: str = Field(
        # Cache LDAP user information
        "ldap_user",
        description="Key for caching LDAP user information",
        validation_alias="CACHE_LDAP_USER_KEY"
    )
    CACHE_LDAP_USER_EX: int = Field(
        86400,
        description="Expiration time of cached LDAP user information",
        validation_alias="CACHE_LDAP_USER_EX"
    )
    LDAP_DEFAULT_ROLE: str = Field(
        default="normal",
        description="Default Roles",
        validation_alias="LDAP_DEFAULT_ROLE"
    )
    LDAP_CONN_TIMEOUT: int = Field(
        default=10,
        description="LDAP connection timeout",
        validation_alias="LDAP_CONN_TIMEOUT"
    )
    LDAP_POOL_SIZE: int = Field(
        default=10,
        description="LDAP connection pool size",
        validation_alias="LDAP_POOL_SIZE"
    )