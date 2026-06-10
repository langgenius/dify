import logging
import os
import socket
import time
from collections.abc import Sequence
from contextlib import contextmanager
from typing import Any

import psycopg2
from sqlalchemy import create_engine

from configs import dify_config

logger = logging.getLogger(__name__)


class AliyunLogStorePG:
    """PostgreSQL protocol support for Aliyun SLS LogStore using SQLAlchemy connection pool."""

    def __init__(self, access_key_id: str, access_key_secret: str, endpoint: str, project_name: str):
        """
        Initialize PG connection for SLS.

        Args:
            access_key_id: Aliyun access key ID
            access_key_secret: Aliyun access key secret
            endpoint: SLS endpoint
            project_name: SLS project name
        """
        self._access_key_id = access_key_id
        self._access_key_secret = access_key_secret
        self._endpoint = endpoint
        self.project_name = project_name
        self._engine: Any = None  # SQLAlchemy Engine
        self._use_pg_protocol = False

    def _check_port_connectivity(self, host: str, port: int, timeout: float = 2.0) -> bool:
        """Fast TCP port check to avoid long waits on unsupported regions."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            result = sock.connect_ex((host, port))
            sock.close()
            return result == 0
        except Exception as e:
            logger.debug("Port connectivity check failed for %s:%d: %s", host, port, str(e))
            return False

    def init_connection(self) -> bool:
        """Initialize SQLAlchemy connection pool with pool_recycle and TCP keepalive support."""
        try:
            pg_host = self._endpoint.replace("http://", "").replace("https://", "")

            # Pool configuration
            pool_size = int(os.environ.get("ALIYUN_SLS_PG_POOL_SIZE", 5))
            max_overflow = int(os.environ.get("ALIYUN_SLS_PG_MAX_OVERFLOW", 5))
            pool_recycle = int(os.environ.get("ALIYUN_SLS_PG_POOL_RECYCLE", 3600))
            pool_pre_ping = os.environ.get("ALIYUN_SLS_PG_POOL_PRE_PING", "false").lower() == "true"

            logger.debug("Check PG protocol connection to SLS: host=%s, project=%s", pg_host, self.project_name)

            # Fast port check to avoid long waits
            if not self._check_port_connectivity(pg_host, 5432, timeout=1.0):
                logger.debug("Using SDK mode for host=%s", pg_host)
                return False

            # Build connection URL
            from urllib.parse import quote_plus

            username = quote_plus(self._access_key_id)
            password = quote_plus(self._access_key_secret)
            database_url = (
                f"postgresql+psycopg2://{username}:{password}@{pg_host}:5432/{self.project_name}?sslmode=require"
            )

            # Create SQLAlchemy engine with connection pool
            self._engine = create_engine(
                database_url,
                pool_size=pool_size,
                max_overflow=max_overflow,
                pool_recycle=pool_recycle,
                pool_pre_ping=pool_pre_ping,
                pool_timeout=30,
                connect_args={
                    "connect_timeout": 5,
                    "application_name": f"Dify-{dify_config.project.version}-fixautocommit",
                    "keepalives": 1,
                    "keepalives_idle": 60,
                    "keepalives_interval": 10,
                    "keepalives_count": 5,
                },
            )

            self._use_pg_protocol = True
            logger.info(
                "PG protocol initialized for SLS project=%s (pool_size=%d, pool_recycle=%ds)",
                self.project_name,
                pool_size,
                pool_recycle,
            )
            return True

        except Exception as e:
            self._use_pg_protocol = False
            if self._engine:
                try:
                    self._engine.dispose()
                except Exception:
                    logger.debug("Failed to dispose engine during cleanup, ignoring")
            self._engine = None

            logger.debug("Using SDK mode for region: %s", str(e))
            return False

    @contextmanager
    def _get_connection(self):
        """Get connection from SQLAlchemy pool. Pool handles recycle, invalidation, and keepalive automatically."""
        if not self._engine:
            raise RuntimeError("SQLAlchemy engine is not initialized")

        connection = self._engine.raw_connection()
        try:
            connection.autocommit = True  # SLS PG protocol does not support transactions
            yield connection
        except Exception:
            raise
        finally:
            connection.close()

    def close(self) -> None:
        """Dispose SQLAlchemy engine and close all connections."""
        if self._engine:
            try:
                self._engine.dispose()
                logger.info("SQLAlchemy engine disposed")
            except Exception:
                logger.exception("Failed to dispose engine")

    def _is_retriable_error(self, error: Exception) -> bool:
        """Check if error is retriable (connection-related issues)."""
        # Check for psycopg2 connection errors directly
        if isinstance(error, (psycopg2.OperationalError, psycopg2.InterfaceError)):
            return True

        error_msg = str(error).lower()
        retriable_patterns = [
            "connection",
            "timeout",
            "closed",
            "broken pipe",
            "reset by peer",
            "no route to host",
            "network",
            "operational error",
            "interface error",
        ]
        return any(pattern in error_msg for pattern in retriable_patterns)

    def put_log(self, logstore: str, contents: Sequence[tuple[str, str]], log_enabled: bool = False) -> None:
        """Write log to SLS using INSERT with automatic retry (3 attempts with exponential backoff)."""
        if not contents:
            return

        fields = [field_name for field_name, _ in contents]
        values = [value for _, value in contents]
        field_list = ", ".join([f'"{field}"' for field in fields])

        if log_enabled:
            logger.info(
                "[LogStore-PG] PUT_LOG | logstore=%s | project=%s | items_count=%d",
                logstore,
                self.project_name,
                len(contents),
            )

        max_retries = 3
        retry_delay = 0.1

        for attempt in range(max_retries):
            try:
                with self._get_connection() as conn:
                    with conn.cursor() as cursor:
                        placeholders = ", ".join(["%s"] * len(fields))
                        values_literal = cursor.mogrify(f"({placeholders})", values).decode("utf-8")
                        insert_sql = f'INSERT INTO "{logstore}" ({field_list}) VALUES {values_literal}'
                        cursor.execute(insert_sql)
                return

            except psycopg2.Error as e:
                if not self._is_retriable_error(e):
                    logger.exception("Failed to put logs to logstore %s (non-retriable error)", logstore)
                    raise

                if attempt < max_retries - 1:
                    logger.warning(
                        "Failed to put logs to logstore %s (attempt %d/%d): %s. Retrying...",
                        logstore,
                        attempt + 1,
                        max_retries,
                        str(e),
                    )
                    time.sleep(retry_delay)
                    retry_delay *= 2
                else:
                    logger.exception("Failed to put logs to logstore %s after %d attempts", logstore, max_retries)
                    raise

    def execute_sql(self, sql: str, logstore: str, log_enabled: bool = False) -> list[dict[str, Any]]:
        """Execute SQL query with automatic retry (3 attempts with exponential backoff)."""
        if log_enabled:
            logger.info(
                "[LogStore-PG] EXECUTE_SQL | logstore=%s | project=%s | sql=%s",
                logstore,
                self.project_name,
                sql,
            )

        max_retries = 3
        retry_delay = 0.1

        for attempt in range(max_retries):
            try:
                with self._get_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(sql)
                        columns = [desc[0] for desc in cursor.description]

                        result = []
                        for row in cursor.fetchall():
                            row_dict = {}
                            for col, val in zip(columns, row):
                                row_dict[col] = "" if val is None else str(val)
                            result.append(row_dict)

                        if log_enabled:
                            logger.info(
                                "[LogStore-PG] EXECUTE_SQL RESULT | logstore=%s | returned_count=%d",
                                logstore,
                                len(result),
                            )

                        return result

            except psycopg2.Error as e:
                if not self._is_retriable_error(e):
                    logger.exception(
                        "Failed to execute SQL on logstore %s (non-retriable error): sql=%s",
                        logstore,
                        sql,
                    )
                    raise

                if attempt < max_retries - 1:
                    logger.warning(
                        "Failed to execute SQL on logstore %s (attempt %d/%d): %s. Retrying...",
                        logstore,
                        attempt + 1,
                        max_retries,
                        str(e),
                    )
                    time.sleep(retry_delay)
                    retry_delay *= 2
                else:
                    logger.exception(
                        "Failed to execute SQL on logstore %s after %d attempts: sql=%s",
                        logstore,
                        max_retries,
                        sql,
                    )
                    raise

        return []
