"""
@File    : ext_ldap.py 
@Time    : 2025/3/5 {TIME}
@Author  : xxlaila
@Software: dify
"""
import json
import logging

from flask_ldap3_login import LDAP3LoginManager

from configs import dify_config
from dify_app import DifyApp


def is_enabled():
    return getattr(dify_config, 'LDAP_ENABLED', False)

def init_app(app: DifyApp):
    """Initialize LDAP authentication integration"""
    if not is_enabled():
        app.ldap_manager = None  # Explicitly set the manager to None
        logging.info("LDAP authentication is disabled")
        return

    # Parsing User Attribute Mapping
    if isinstance(dify_config.AUTH_LDAP_USER_ATTR_MAP, str):
        ldap_user_attr_map = json.loads(dify_config.AUTH_LDAP_USER_ATTR_MAP)
    else:
        ldap_user_attr_map = dify_config.AUTH_LDAP_USER_ATTR_MAP

    # Setting up LDAP configuration
    app.config.update({
        "LDAP_HOST": dify_config.AUTH_LDAP_SERVER_URI,
        "LDAP_BASE_DN": dify_config.AUTH_LDAP_SEARCH_BASE_DN,
        "LDAP_BIND_DN": dify_config.AUTH_LDAP_BIND_DN,
        "LDAP_BIND_PASSWORD": dify_config.AUTH_LDAP_BIND_PASSWORD,
        "LDAP_USER_FILTER": dify_config.AUTH_LDAP_USER_FILTER,
        "LDAP_USER_RDN_ATTR": "uid",
        "LDAP_USER_LOGIN_ATTR": "uid",
        "LDAP_USER_SEARCH_SCOPE": "SUBTREE",
        "LDAP_USER_MAPPING": ldap_user_attr_map,
        "LDAP_DEFAULT_ROLE": dify_config.LDAP_DEFAULT_ROLE,
    })


    # Initializing the LDAP Manager
    ldap_manager = LDAP3LoginManager()
    ldap_manager.init_app(app)

    # Mount the LDAP manager into the app
    app.ldap_manager = ldap_manager
    # Confirm that the mount was successful
    logging.info(f"LDAP manager mounted: {hasattr(app, 'ldap_manager')}")


    # Configuring Logging
    if app.debug:
        app.logger.info("LDAP configuration loaded：")
        app.logger.info(f"Server: {app.config['LDAP_HOST']}")
        app.logger.info(f"Base DN: {app.config['LDAP_BASE_DN']}")

    return ldap_manager
