import logging
import os
import socket
import time
from collections.abc import Sequence
from contextlib import contextmanager
from typing import Any

import psycopg2
import psycopg2.pool
from psycopg2 import InterfaceError, OperationalError

from configs import dify_config

logger = logging.getLogger(__name__)


class AliyunLogStorePG:
    """
    PostgreSQL protocol support for Aliyun SLS LogStore.

    Handles PG connection pooling and operations for regions that support PG protocol.
    """

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
        self._pg_pool: psycopg2.pool.SimpleConnectionPool | None = None
        self._use_pg_protocol = False

    def _check_port_connectivity(self, host: str, port: int, timeout: float = 2.0) -> bool:
        """
        Check if a TCP port is reachable using socket connection.

        This provides a fast check before attempting full database connection,
        preventing long waits when connecting to unsupported regions.

        Args:
            host: Hostname or IP address
            port: Port number
            timeout: Connection timeout in seconds (default: 2.0)

        Returns:
            True if port is reachable, False otherwise
        """
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
        """
        Initialize PostgreSQL connection pool for SLS PG protocol support.

        Attempts to connect to SLS using PostgreSQL protocol. If successful, sets
        _use_pg_protocol to True and creates a connection pool. If connection fails
        (region doesn't support PG protocol or other errors), returns False.

        Returns:
            True if PG protocol is supported and initialized, False otherwise
        """
        try:
            # Extract hostname from endpoint (remove protocol if present)
            pg_host = self._endpoint.replace("http://", "").replace("https://", "")

            # Get pool configuration
            pg_max_connections = int(os.environ.get("ALIYUN_SLS_PG_MAX_CONNECTIONS", 10))

            logger.debug(
                "Check PG protocol connection to SLS: host=%s, project=%s",
                pg_host,
                self.project_name,
            )

            # Fast port connectivity check before attempting full connection
            # This prevents long waits when connecting to unsupported regions
            if not self._check_port_connectivity(pg_host, 5432, timeout=1.0):
                logger.info(
                    "USE SDK mode for read/write operations, host=%s",
                    pg_host,
                )
                return False

            # Create connection pool
            self._pg_pool = psycopg2.pool.SimpleConnectionPool(
                minconn=1,
                maxconn=pg_max_connections,
                host=pg_host,
                port=5432,
                database=self.project_name,
                user=self._access_key_id,
                password=self._access_key_secret,
                sslmode="require",
                connect_timeout=5,
                application_name=f"Dify-{dify_config.project.version}",
            )

            # Note: Skip test query because SLS PG protocol only supports SELECT/INSERT on actual tables
            # Connection pool creation success already indicates connectivity

            self._use_pg_protocol = True
            logger.info(
                "PG protocol initialized successfully for SLS project=%s. Will use PG for read/write operations.",
                self.project_name,
            )
            return True

        except Exception as e:
            # PG connection failed - fallback to SDK mode
            self._use_pg_protocol = False
            if self._pg_pool:
                try:
                    self._pg_pool.closeall()
                except Exception:
                    logger.debug("Failed to close PG connection pool during cleanup, ignoring")
            self._pg_pool = None

            logger.info(
                "PG protocol connection failed (region may not support PG protocol): %s. "
                "Falling back to SDK mode for read/write operations.",
                str(e),
            )
            return False

    def _is_connection_valid(self, conn: Any) -> bool:
        """
        Check if a connection is still valid.

        Args:
            conn: psycopg2 connection object

        Returns:
            True if connection is valid, False otherwise
        """
        try:
            # Check if connection is closed
            if conn.closed:
                return False

            # Quick ping test - execute a lightweight query
            # For SLS PG protocol, we can't use SELECT 1 without FROM,
            # so we just check the connection status
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
            return True
        except Exception:
            return False

    @contextmanager
    def _get_connection(self):
        """
        Context manager to get a PostgreSQL connection from the pool.

        Automatically validates and refreshes stale connections.

        Note: Aliyun SLS PG protocol does not support transactions, so we always
        use autocommit mode.

        Yields:
            psycopg2 connection object

        Raises:
            RuntimeError: If PG pool is not initialized
        """
        if not self._pg_pool:
            raise RuntimeError("PG connection pool is not initialized")

        conn = self._pg_pool.getconn()
        try:
            # Validate connection and get a fresh one if needed
            if not self._is_connection_valid(conn):
                logger.debug("Connection is stale, marking as bad and getting a new one")
                # Mark connection as bad and get a new one
                self._pg_pool.putconn(conn, close=True)
                conn = self._pg_pool.getconn()

            # Aliyun SLS PG protocol does not support transactions, always use autocommit
            conn.autocommit = True
            yield conn
        finally:
            # Return connection to pool (or close if it's bad)
            if self._is_connection_valid(conn):
                self._pg_pool.putconn(conn)
            else:
                self._pg_pool.putconn(conn, close=True)

    def close(self) -> None:
        """Close the PostgreSQL connection pool."""
        if self._pg_pool:
            try:
                self._pg_pool.closeall()
                logger.info("PG connection pool closed")
            except Exception:
                logger.exception("Failed to close PG connection pool")

    def _is_retriable_error(self, error: Exception) -> bool:
        """
        Check if an error is retriable (connection-related issues).

        Args:
            error: Exception to check

        Returns:
            True if the error is retriable, False otherwise
        """
        # Retry on connection-related errors
        if isinstance(error, (OperationalError, InterfaceError)):
            return True

        # Check error message for specific connection issues
        error_msg = str(error).lower()
        retriable_patterns = [
            "connection",
            "timeout",
            "closed",
            "broken pipe",
            "reset by peer",
            "no route to host",
            "network",
        ]
        return any(pattern in error_msg for pattern in retriable_patterns)

    def put_log(self, logstore: str, contents: Sequence[tuple[str, str]], log_enabled: bool = False) -> None:
        """
        Write log to SLS using PostgreSQL protocol with automatic retry.

        Note: SLS PG protocol only supports INSERT (not UPDATE). This uses append-only
        writes with log_version field for versioning, same as SDK implementation.

        Args:
            logstore: Name of the logstore table
            contents: List of (field_name, value) tuples
            log_enabled: Whether to enable logging

        Raises:
            psycopg2.Error: If database operation fails after all retries
        """
        if not contents:
            return

        # Extract field names and values from contents
        fields = [field_name for field_name, _ in contents]
        values = [value for _, value in contents]

        # Build INSERT statement with literal values
        # Note: Aliyun SLS PG protocol doesn't support parameterized queries,
        # so we need to use mogrify to safely create literal values
        field_list = ", ".join([f'"{field}"' for field in fields])

        if log_enabled:
            logger.info(
                "[LogStore-PG] PUT_LOG | logstore=%s | project=%s | items_count=%d",
                logstore,
                self.project_name,
                len(contents),
            )

        # Retry configuration
        max_retries = 3
        retry_delay = 0.1  # Start with 100ms

        for attempt in range(max_retries):
            try:
                with self._get_connection() as conn:
                    with conn.cursor() as cursor:
                        # Use mogrify to safely convert values to SQL literals
                        placeholders = ", ".join(["%s"] * len(fields))
                        values_literal = cursor.mogrify(f"({placeholders})", values).decode("utf-8")
                        insert_sql = f'INSERT INTO "{logstore}" ({field_list}) VALUES {values_literal}'
                        cursor.execute(insert_sql)
                # Success - exit retry loop
                return

            except psycopg2.Error as e:
                # Check if error is retriable
                if not self._is_retriable_error(e):
                    # Not a retriable error (e.g., data validation error), fail immediately
                    logger.exception(
                        "Failed to put logs to logstore %s via PG protocol (non-retriable error)",
                        logstore,
                    )
                    raise

                # Retriable error - log and retry if we have attempts left
                if attempt < max_retries - 1:
                    logger.warning(
                        "Failed to put logs to logstore %s via PG protocol (attempt %d/%d): %s. Retrying...",
                        logstore,
                        attempt + 1,
                        max_retries,
                        str(e),
                    )
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    # Last attempt failed
                    logger.exception(
                        "Failed to put logs to logstore %s via PG protocol after %d attempts",
                        logstore,
                        max_retries,
                    )
                    raise

    def execute_sql(self, sql: str, logstore: str, log_enabled: bool = False) -> list[dict[str, Any]]:
        """
        Execute SQL query using PostgreSQL protocol with automatic retry.

        Args:
            sql: SQL query string
            logstore: Name of the logstore (for logging purposes)
            log_enabled: Whether to enable logging

        Returns:
            List of result rows as dictionaries

        Raises:
            psycopg2.Error: If database operation fails after all retries
        """
        if log_enabled:
            logger.info(
                "[LogStore-PG] EXECUTE_SQL | logstore=%s | project=%s | sql=%s",
                logstore,
                self.project_name,
                sql,
            )

        # Retry configuration
        max_retries = 3
        retry_delay = 0.1  # Start with 100ms

        for attempt in range(max_retries):
            try:
                with self._get_connection() as conn:
                    with conn.cursor() as cursor:
                        cursor.execute(sql)

                        # Get column names from cursor description
                        columns = [desc[0] for desc in cursor.description]

                        # Fetch all results and convert to list of dicts
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
                # Check if error is retriable
                if not self._is_retriable_error(e):
                    # Not a retriable error (e.g., SQL syntax error), fail immediately
                    logger.exception(
                        "Failed to execute SQL query on logstore %s via PG protocol (non-retriable error): sql=%s",
                        logstore,
                        sql,
                    )
                    raise

                # Retriable error - log and retry if we have attempts left
                if attempt < max_retries - 1:
                    logger.warning(
                        "Failed to execute SQL query on logstore %s via PG protocol (attempt %d/%d): %s. Retrying...",
                        logstore,
                        attempt + 1,
                        max_retries,
                        str(e),
                    )
                    time.sleep(retry_delay)
                    retry_delay *= 2  # Exponential backoff
                else:
                    # Last attempt failed
                    logger.exception(
                        "Failed to execute SQL query on logstore %s via PG protocol after %d attempts: sql=%s",
                        logstore,
                        max_retries,
                        sql,
                    )
                    raise

        # This line should never be reached due to raise above, but makes type checker happy
        return []
