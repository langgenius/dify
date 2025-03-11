"""
@File    : ext_ldap.py 
@Time    : 2025/3/5 {TIME}
@Author  : xxlaila
@Software: dify
"""
import json
import logging
from queue import Queue

from flask_ldap3_login import LDAP3LoginManager
from ldap3 import ALL, Connection, Server

from configs import dify_config
from dify_app import DifyApp


def is_enabled():
    return getattr(dify_config, 'LDAP_ENABLED', False)

def create_ldap_pool():
    pool = Queue(maxsize=dify_config.LDAP_POOL_SIZE)
    for i in range(dify_config.LDAP_POOL_SIZE):
        server = Server(dify_config.AUTH_LDAP_SERVER_URI, get_info=ALL)
        conn = Connection(
            server,
            user=dify_config.AUTH_LDAP_BIND_DN,
            password=dify_config.AUTH_LDAP_BIND_PASSWORD,
            receive_timeout=dify_config.LDAP_CONN_TIMEOUT
        )
        if conn.bind():
            logging.info(f"LDAP connection {i} bound successfully")
            pool.put(conn)
        else:
            logging.error(f"LDAP connection {i} failed to bind")
    return pool

def get_ldap_connection():
    """Get a connection from the connection pool"""
    conn = LDAP_POOL.get()

    # Add connection validity check
    if not conn.bound or not conn.server:
        try:
            if not conn.bind():
                logging.error("LDAP connection is unbound, rebinding...")
                conn.unbind()
                server = Server(dify_config.AUTH_LDAP_SERVER_URI, get_info=ALL)
                new_conn = Connection(
                    server,
                    user=dify_config.AUTH_LDAP_BIND_DN,
                    password=dify_config.AUTH_LDAP_BIND_PASSWORD,
                    receive_timeout=dify_config.LDAP_CONN_TIMEOUT
                )
                if new_conn.bind():
                    return new_conn
                raise Exception("LDAP connection reconstruction failed")
        except Exception as e:
            logging.exception(f"LDAP connection recovery failed: {e}")
            raise
    return conn

def release_ldap_connection(conn):
    """Return the connection to the connection pool"""
    try:
        # Reset connection status
        if conn.bound:
            conn.unbind()
        conn.open()  # Reopen connection without binding
        LDAP_POOL.put(conn)
    except Exception as e:
        logging.exception(f"Failed to recycle LDAP connection: {str(e)}")
        conn.unbind()

def init_app(app: DifyApp):
    """Initialize LDAP authentication integration"""
    if not is_enabled():
        app.ldap_manager = None  # Explicitly set the manager to None
        logging.info("LDAP authentication is disabled")
        return

    # Global LDAP connection pool
    global LDAP_POOL
    LDAP_POOL = create_ldap_pool()

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
