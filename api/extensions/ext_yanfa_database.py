"""
Yanfa External Database Extension
用于连接Yanfa系统的用户数据库，实现共用账号体系
"""
from urllib.parse import quote_plus

from flask import Flask
from sqlalchemy import create_engine
from sqlalchemy.orm import scoped_session, sessionmaker

from configs import dify_config


class YanfaDatabase:
    """Yanfa数据库连接管理器"""

    _engine = None
    _session_factory = None
    _scoped_session = None

    @classmethod
    def get_database_uri(cls) -> str:
        """获取Yanfa数据库连接URI"""
        return (
            f"mysql+pymysql://"
            f"{quote_plus(dify_config.YANFA_DB_USERNAME)}:"
            f"{quote_plus(dify_config.YANFA_DB_PASSWORD)}@"
            f"{dify_config.YANFA_DB_HOST}:{dify_config.YANFA_DB_PORT}/"
            f"{dify_config.YANFA_DB_DATABASE}?charset=utf8mb4"
        )

    @classmethod
    def init_engine(cls):
        """初始化数据库引擎"""
        if cls._engine is None and dify_config.YANFA_AUTH_ENABLED:
            cls._engine = create_engine(
                cls.get_database_uri(),
                pool_size=5,
                max_overflow=10,
                pool_recycle=3600,
                pool_pre_ping=True,
                echo=False
            )
            cls._session_factory = sessionmaker(bind=cls._engine)
            cls._scoped_session = scoped_session(cls._session_factory)
        return cls._engine

    @classmethod
    def get_session(cls):
        """获取数据库会话"""
        if cls._scoped_session is None:
            cls.init_engine()
        return cls._scoped_session

    @classmethod
    def remove_session(cls):
        """移除当前会话"""
        if cls._scoped_session:
            cls._scoped_session.remove()


# 全局数据库实例
yanfa_db = YanfaDatabase()


def init_app(app: Flask):
    """初始化Yanfa数据库扩展"""
    if dify_config.YANFA_AUTH_ENABLED:
        yanfa_db.init_engine()

        @app.teardown_appcontext
        def remove_yanfa_session(exception=None):
            yanfa_db.remove_session()
