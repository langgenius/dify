from __future__ import annotations

import logging
import os
import socket
import threading
import time
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from aliyun.log import (  # type: ignore[import-untyped]
    GetLogsRequest,
    IndexConfig,
    IndexKeyConfig,
    IndexLineConfig,
    LogClient,
    LogItem,
    PutLogsRequest,
)
from aliyun.log.auth import AUTH_VERSION_4  # type: ignore[import-untyped]
from aliyun.log.logexception import LogException  # type: ignore[import-untyped]
from dotenv import load_dotenv
from sqlalchemy.orm import DeclarativeBase

from configs import dify_config
from extensions.logstore.aliyun_logstore_pg import AliyunLogStorePG

logger = logging.getLogger(__name__)


class AliyunLogStore:
    """
    Singleton class for Aliyun SLS LogStore operations.

    Ensures only one instance exists to prevent multiple PG connection pools.
    """

    _instance: AliyunLogStore | None = None
    _initialized: bool = False

    # Track delayed PG connection for newly created projects
    _pg_connection_timer: threading.Timer | None = None
    _pg_connection_delay: int = 90  # delay seconds

    # Default tokenizer for text/json fields and full-text index
    # Common delimiters: comma, space, quotes, punctuation, operators, brackets, special chars
    DEFAULT_TOKEN_LIST = [
        ",",
        " ",
        '"',
        '"',
        ";",
        "=",
        "(",
        ")",
        "[",
        "]",
        "{",
        "}",
        "?",
        "@",
        "&",
        "<",
        ">",
        "/",
        ":",
        "\n",
        "\t",
    ]

    def __new__(cls) -> AliyunLogStore:
        """Implement singleton pattern."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    project_des = "dify"

    workflow_execution_logstore = "workflow_execution"

    workflow_node_execution_logstore = "workflow_node_execution"

    @staticmethod
    def _sqlalchemy_type_to_logstore_type(column: Any) -> str:
        """
        Map SQLAlchemy column type to Aliyun LogStore index type.

        Args:
            column: SQLAlchemy column object

        Returns:
            LogStore index type: 'text', 'long', 'double', or 'json'
        """
        column_type = column.type

        # Integer types -> long
        if isinstance(column_type, (sa.Integer, sa.BigInteger, sa.SmallInteger)):
            return "long"

        # Float types -> double
        if isinstance(column_type, (sa.Float, sa.Numeric)):
            return "double"

        # String and Text types -> text
        if isinstance(column_type, (sa.String, sa.Text)):
            return "text"

        # DateTime -> text (stored as ISO format string in logstore)
        if isinstance(column_type, sa.DateTime):
            return "text"

        # Boolean -> long (stored as 0/1)
        if isinstance(column_type, sa.Boolean):
            return "long"

        # JSON -> json
        if isinstance(column_type, sa.JSON):
            return "json"

        # Default to text for unknown types
        return "text"

    @staticmethod
    def _generate_index_keys_from_model(model_class: type[DeclarativeBase]) -> dict[str, IndexKeyConfig]:
        """
        Automatically generate LogStore field index configuration from SQLAlchemy model.

        This method introspects the SQLAlchemy model's column definitions and creates
        corresponding LogStore index configurations. When the PG schema is updated via
        Flask-Migrate, this method will automatically pick up the new fields on next startup.

        Args:
            model_class: SQLAlchemy model class (e.g., WorkflowRun, WorkflowNodeExecutionModel)

        Returns:
            Dictionary mapping field names to IndexKeyConfig objects
        """
        index_keys = {}

        # Iterate over all mapped columns in the model
        if hasattr(model_class, "__mapper__"):
            for column_name, column_property in model_class.__mapper__.columns.items():
                # Skip relationship properties and other non-column attributes
                if not hasattr(column_property, "type"):
                    continue

                # Map SQLAlchemy type to LogStore type
                logstore_type = AliyunLogStore._sqlalchemy_type_to_logstore_type(column_property)

                # Create index configuration
                # - text fields: case_insensitive for better search, with tokenizer and Chinese support
                # - all fields: doc_value=True for analytics
                if logstore_type == "text":
                    index_keys[column_name] = IndexKeyConfig(
                        index_type="text",
                        case_sensitive=False,
                        doc_value=True,
                        token_list=AliyunLogStore.DEFAULT_TOKEN_LIST,
                        chinese=True,
                    )
                else:
                    index_keys[column_name] = IndexKeyConfig(index_type=logstore_type, doc_value=True)

        # Add log_version field (not in PG model, but used in logstore for versioning)
        index_keys["log_version"] = IndexKeyConfig(index_type="long", doc_value=True)

        return index_keys

    def __init__(self) -> None:
        # Skip initialization if already initialized (singleton pattern)
        if self.__class__._initialized:
            return

        load_dotenv()

        self.access_key_id: str = os.environ.get("ALIYUN_SLS_ACCESS_KEY_ID", "")
        self.access_key_secret: str = os.environ.get("ALIYUN_SLS_ACCESS_KEY_SECRET", "")
        self.endpoint: str = os.environ.get("ALIYUN_SLS_ENDPOINT", "")
        self.region: str = os.environ.get("ALIYUN_SLS_REGION", "")
        self.project_name: str = os.environ.get("ALIYUN_SLS_PROJECT_NAME", "")
        self.logstore_ttl: int = int(os.environ.get("ALIYUN_SLS_LOGSTORE_TTL", 365))
        self.log_enabled: bool = (
            os.environ.get("SQLALCHEMY_ECHO", "false").lower() == "true"
            or os.environ.get("LOGSTORE_SQL_ECHO", "false").lower() == "true"
        )
        self.pg_mode_enabled: bool = os.environ.get("LOGSTORE_PG_MODE_ENABLED", "true").lower() == "true"

        # Get timeout configuration
        check_timeout = int(os.environ.get("ALIYUN_SLS_CHECK_CONNECTIVITY_TIMEOUT", 30))

        # Pre-check endpoint connectivity to prevent indefinite hangs
        self._check_endpoint_connectivity(self.endpoint, check_timeout)

        # Initialize SDK client
        self.client = LogClient(
            self.endpoint, self.access_key_id, self.access_key_secret, auth_version=AUTH_VERSION_4, region=self.region
        )

        # Append Dify identification to the existing user agent
        original_user_agent = self.client._user_agent  # pyright: ignore[reportPrivateUsage]
        dify_version = dify_config.project.version
        enhanced_user_agent = f"Dify,Dify-{dify_version},{original_user_agent}"
        self.client.set_user_agent(enhanced_user_agent)

        # PG client will be initialized in init_project_logstore
        self._pg_client: AliyunLogStorePG | None = None
        self._use_pg_protocol: bool = False

        self.__class__._initialized = True

    @staticmethod
    def _check_endpoint_connectivity(endpoint: str, timeout: int) -> None:
        """
        Check if the SLS endpoint is reachable before creating LogClient.
        Prevents indefinite hangs when the endpoint is unreachable.

        Args:
            endpoint: SLS endpoint URL
            timeout: Connection timeout in seconds

        Raises:
            ConnectionError: If endpoint is not reachable
        """
        # Parse endpoint URL to extract hostname and port
        from urllib.parse import urlparse

        parsed_url = urlparse(endpoint if "://" in endpoint else f"http://{endpoint}")
        hostname = parsed_url.hostname
        port = parsed_url.port or (443 if parsed_url.scheme == "https" else 80)

        if not hostname:
            raise ConnectionError(f"Invalid endpoint URL: {endpoint}")

        sock = None
        try:
            # Create socket and set timeout
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((hostname, port))
        except Exception as e:
            # Catch all exceptions and provide clear error message
            error_type = type(e).__name__
            raise ConnectionError(
                f"Cannot connect to {hostname}:{port} (timeout={timeout}s): [{error_type}] {e}"
            ) from e
        finally:
            # Ensure socket is properly closed
            if sock:
                try:
                    sock.close()
                except Exception:  # noqa: S110
                    pass  # Ignore errors during cleanup

    @property
    def supports_pg_protocol(self) -> bool:
        """Check if PG protocol is supported and enabled."""
        return self._use_pg_protocol

    def _attempt_pg_connection_init(self) -> bool:
        """
        Attempt to initialize PG connection.

        This method tries to establish PG connection and performs necessary checks.
        It's used both for immediate connection (existing projects) and delayed connection (new projects).

        Returns:
            True if PG connection was successfully established, False otherwise.
        """
        if not self.pg_mode_enabled or not self._pg_client:
            return False

        try:
            self._use_pg_protocol = self._pg_client.init_connection()
            if self._use_pg_protocol:
                logger.info("Using PG protocol for project %s", self.project_name)
                # Check if scan_index is enabled for all logstores
                self._check_and_disable_pg_if_scan_index_disabled()
                return True
            else:
                logger.info("Using SDK mode for project %s", self.project_name)
                return False
        except Exception as e:
            logger.info("Using SDK mode for project %s", self.project_name)
            logger.debug("PG connection details: %s", str(e))
            self._use_pg_protocol = False
            return False

    def _delayed_pg_connection_init(self) -> None:
        """
        Delayed initialization of PG connection for newly created projects.

        This method is called by a background timer 3 minutes after project creation.
        """
        # Double check conditions in case state changed
        if self._use_pg_protocol:
            return

        self._attempt_pg_connection_init()
        self.__class__._pg_connection_timer = None

    def init_project_logstore(self):
        """
        Initialize project, logstore, index, and PG connection.

        This method should be called once during application startup to ensure
        all required resources exist and connections are established.
        """
        # Step 1: Ensure project and logstore exist
        project_is_new = False
        if not self.is_project_exist():
            self.create_project()
            project_is_new = True

        self.create_logstore_if_not_exist()

        # Step 2: Initialize PG client and connection (if enabled)
        if not self.pg_mode_enabled:
            logger.info("PG mode is disabled. Will use SDK mode.")
            return

        # Create PG client if not already created
        if self._pg_client is None:
            logger.info("Initializing PG client for project %s...", self.project_name)
            self._pg_client = AliyunLogStorePG(
                self.access_key_id, self.access_key_secret, self.endpoint, self.project_name
            )

        # Step 3: Establish PG connection based on project status
        if project_is_new:
            # For newly created projects, schedule delayed PG connection
            self._use_pg_protocol = False
            logger.info("Using SDK mode for project %s (newly created)", self.project_name)
            if self.__class__._pg_connection_timer is not None:
                self.__class__._pg_connection_timer.cancel()
            self.__class__._pg_connection_timer = threading.Timer(
                self.__class__._pg_connection_delay,
                self._delayed_pg_connection_init,
            )
            self.__class__._pg_connection_timer.daemon = True  # Don't block app shutdown
            self.__class__._pg_connection_timer.start()
        else:
            # For existing projects, attempt PG connection immediately
            self._attempt_pg_connection_init()

    def _check_and_disable_pg_if_scan_index_disabled(self) -> None:
        """
        Check if scan_index is enabled for all logstores.
        If any logstore has scan_index=false, disable PG protocol.

        This is necessary because PG protocol requires scan_index to be enabled.
        """
        logstore_name_list = [
            AliyunLogStore.workflow_execution_logstore,
            AliyunLogStore.workflow_node_execution_logstore,
        ]

        for logstore_name in logstore_name_list:
            existing_config = self.get_existing_index_config(logstore_name)
            if existing_config and not existing_config.scan_index:
                logger.info(
                    "Logstore %s requires scan_index enabled, using SDK mode for project %s",
                    logstore_name,
                    self.project_name,
                )
                self._use_pg_protocol = False
                # Close PG connection if it was initialized
                if self._pg_client:
                    self._pg_client.close()
                    self._pg_client = None
                return

    def is_project_exist(self) -> bool:
        try:
            self.client.get_project(self.project_name)
            return True
        except Exception as e:
            if e.args[0] == "ProjectNotExist":
                return False
            else:
                raise e

    def create_project(self):
        try:
            self.client.create_project(self.project_name, AliyunLogStore.project_des)
            logger.info("Project %s created successfully", self.project_name)
        except LogException as e:
            logger.exception(
                "Failed to create project %s: errorCode=%s, errorMessage=%s, requestId=%s",
                self.project_name,
                e.get_error_code(),
                e.get_error_message(),
                e.get_request_id(),
            )
            raise

    def is_logstore_exist(self, logstore_name: str) -> bool:
        try:
            _ = self.client.get_logstore(self.project_name, logstore_name)
            return True
        except Exception as e:
            if e.args[0] == "LogStoreNotExist":
                return False
            else:
                raise e

    def create_logstore_if_not_exist(self) -> None:
        logstore_name_list = [
            AliyunLogStore.workflow_execution_logstore,
            AliyunLogStore.workflow_node_execution_logstore,
        ]

        for logstore_name in logstore_name_list:
            if not self.is_logstore_exist(logstore_name):
                try:
                    self.client.create_logstore(
                        project_name=self.project_name, logstore_name=logstore_name, ttl=self.logstore_ttl
                    )
                    logger.info("logstore %s created successfully", logstore_name)
                except LogException as e:
                    logger.exception(
                        "Failed to create logstore %s: errorCode=%s, errorMessage=%s, requestId=%s",
                        logstore_name,
                        e.get_error_code(),
                        e.get_error_message(),
                        e.get_request_id(),
                    )
                    raise

            # Ensure index contains all Dify-required fields
            # This intelligently merges with existing config, preserving custom indexes
            self.ensure_index_config(logstore_name)

    def is_index_exist(self, logstore_name: str) -> bool:
        try:
            _ = self.client.get_index_config(self.project_name, logstore_name)
            return True
        except Exception as e:
            if e.args[0] == "IndexConfigNotExist":
                return False
            else:
                raise e

    def get_existing_index_config(self, logstore_name: str) -> IndexConfig | None:
        """
        Get existing index configuration from logstore.

        Args:
            logstore_name: Name of the logstore

        Returns:
            IndexConfig object if index exists, None otherwise
        """
        try:
            response = self.client.get_index_config(self.project_name, logstore_name)
            return response.get_index_config()
        except Exception as e:
            if e.args[0] == "IndexConfigNotExist":
                return None
            else:
                logger.exception("Failed to get index config for logstore %s", logstore_name)
                raise e

    def _get_workflow_execution_index_keys(self) -> dict[str, IndexKeyConfig]:
        """
        Get field index configuration for workflow_execution logstore.

        This method automatically generates index configuration from the WorkflowRun SQLAlchemy model.
        When the PG schema is updated via Flask-Migrate, the index configuration will be automatically
        updated on next application startup.
        """
        from models.workflow import WorkflowRun

        index_keys = self._generate_index_keys_from_model(WorkflowRun)

        # Add custom fields that are in logstore but not in PG model
        # These fields are added by the repository layer
        index_keys["error_message"] = IndexKeyConfig(
            index_type="text",
            case_sensitive=False,
            doc_value=True,
            token_list=self.DEFAULT_TOKEN_LIST,
            chinese=True,
        )  # Maps to 'error' in PG
        index_keys["started_at"] = IndexKeyConfig(
            index_type="text",
            case_sensitive=False,
            doc_value=True,
            token_list=self.DEFAULT_TOKEN_LIST,
            chinese=True,
        )  # Maps to 'created_at' in PG

        logger.info("Generated %d index keys for workflow_execution from WorkflowRun model", len(index_keys))
        return index_keys

    def _get_workflow_node_execution_index_keys(self) -> dict[str, IndexKeyConfig]:
        """
        Get field index configuration for workflow_node_execution logstore.

        This method automatically generates index configuration from the WorkflowNodeExecutionModel.
        When the PG schema is updated via Flask-Migrate, the index configuration will be automatically
        updated on next application startup.
        """
        from models.workflow import WorkflowNodeExecutionModel

        index_keys = self._generate_index_keys_from_model(WorkflowNodeExecutionModel)

        logger.debug(
            "Generated %d index keys for workflow_node_execution from WorkflowNodeExecutionModel", len(index_keys)
        )
        return index_keys

    def _get_index_config(self, logstore_name: str) -> IndexConfig:
        """
        Get index configuration for the specified logstore.

        Args:
            logstore_name: Name of the logstore

        Returns:
            IndexConfig object with line and field indexes
        """
        # Create full-text index (line config) with tokenizer
        line_config = IndexLineConfig(token_list=self.DEFAULT_TOKEN_LIST, case_sensitive=False, chinese=True)

        # Get field index configuration based on logstore name
        field_keys = {}
        if logstore_name == AliyunLogStore.workflow_execution_logstore:
            field_keys = self._get_workflow_execution_index_keys()
        elif logstore_name == AliyunLogStore.workflow_node_execution_logstore:
            field_keys = self._get_workflow_node_execution_index_keys()

        # key_config_list should be a dict, not a list
        # Create index config with both line and field indexes
        return IndexConfig(line_config=line_config, key_config_list=field_keys, scan_index=True)

    def create_index(self, logstore_name: str) -> None:
        """
        Create index for the specified logstore with both full-text and field indexes.
        Field indexes are automatically generated from the corresponding SQLAlchemy model.
        """
        index_config = self._get_index_config(logstore_name)

        try:
            self.client.create_index(self.project_name, logstore_name, index_config)
            logger.info(
                "index for %s created successfully with %d field indexes",
                logstore_name,
                len(index_config.key_config_list or {}),
            )
        except LogException as e:
            logger.exception(
                "Failed to create index for logstore %s: errorCode=%s, errorMessage=%s, requestId=%s",
                logstore_name,
                e.get_error_code(),
                e.get_error_message(),
                e.get_request_id(),
            )
            raise

    def _merge_index_configs(
        self, existing_config: IndexConfig, required_keys: dict[str, IndexKeyConfig], logstore_name: str
    ) -> tuple[IndexConfig, bool]:
        """
        Intelligently merge existing index config with Dify's required field indexes.

        This method:
        1. Preserves all existing field indexes in logstore (including custom fields)
        2. Adds missing Dify-required fields
        3. Updates fields where type doesn't match (with json/text compatibility)
        4. Corrects case mismatches (e.g., if Dify needs 'status' but logstore has 'Status')

        Type compatibility rules:
        - json and text types are considered compatible (users can manually choose either)
        - All other type mismatches will be corrected to match Dify requirements

        Note: Logstore is case-sensitive and doesn't allow duplicate fields with different cases.
        Case mismatch means: existing field name differs from required name only in case.

        Args:
            existing_config: Current index configuration from logstore
            required_keys: Dify's required field index configurations
            logstore_name: Name of the logstore (for logging)

        Returns:
            Tuple of (merged_config, needs_update)
        """
        # key_config_list is already a dict in the SDK
        # Make a copy to avoid modifying the original
        existing_keys = dict(existing_config.key_config_list) if existing_config.key_config_list else {}

        # Track changes
        needs_update = False
        case_corrections = []  # Fields that need case correction (e.g., 'Status' -> 'status')
        missing_fields = []
        type_mismatches = []

        # First pass: Check for and resolve case mismatches with required fields
        # Note: Logstore itself doesn't allow duplicate fields with different cases,
        # so we only need to check if the existing case matches the required case
        for required_name in required_keys:
            lower_name = required_name.lower()
            # Find key that matches case-insensitively but not exactly
            wrong_case_key = None
            for existing_key in existing_keys:
                if existing_key.lower() == lower_name and existing_key != required_name:
                    wrong_case_key = existing_key
                    break

            if wrong_case_key:
                # Field exists but with wrong case (e.g., 'Status' when we need 'status')
                # Remove the wrong-case key, will be added back with correct case later
                case_corrections.append((wrong_case_key, required_name))
                del existing_keys[wrong_case_key]
                needs_update = True

        # Second pass: Check each required field
        for required_name, required_config in required_keys.items():
            # Check for exact match (case-sensitive)
            if required_name in existing_keys:
                existing_type = existing_keys[required_name].index_type
                required_type = required_config.index_type

                # Check if type matches
                # Special case: json and text are interchangeable for JSON content fields
                # Allow users to manually configure text instead of json (or vice versa) without forcing updates
                is_compatible = existing_type == required_type or ({existing_type, required_type} == {"json", "text"})

                if not is_compatible:
                    type_mismatches.append((required_name, existing_type, required_type))
                    # Update with correct type
                    existing_keys[required_name] = required_config
                    needs_update = True
                # else: field exists with compatible type, no action needed
            else:
                # Field doesn't exist (may have been removed in first pass due to case conflict)
                missing_fields.append(required_name)
                existing_keys[required_name] = required_config
                needs_update = True

        # Log changes
        if missing_fields:
            logger.info(
                "Logstore %s: Adding %d missing Dify-required fields: %s",
                logstore_name,
                len(missing_fields),
                ", ".join(missing_fields[:10]) + ("..." if len(missing_fields) > 10 else ""),
            )

        if type_mismatches:
            logger.info(
                "Logstore %s: Fixing %d type mismatches: %s",
                logstore_name,
                len(type_mismatches),
                ", ".join([f"{name}({old}->{new})" for name, old, new in type_mismatches[:5]])
                + ("..." if len(type_mismatches) > 5 else ""),
            )

        if case_corrections:
            logger.info(
                "Logstore %s: Correcting %d field name cases: %s",
                logstore_name,
                len(case_corrections),
                ", ".join([f"'{old}' -> '{new}'" for old, new in case_corrections[:5]])
                + ("..." if len(case_corrections) > 5 else ""),
            )

        # Create merged config
        # key_config_list should be a dict, not a list
        # Preserve the original scan_index value - don't force it to True
        merged_config = IndexConfig(
            line_config=existing_config.line_config
            or IndexLineConfig(token_list=self.DEFAULT_TOKEN_LIST, case_sensitive=False, chinese=True),
            key_config_list=existing_keys,
            scan_index=existing_config.scan_index,
        )

        return merged_config, needs_update

    def ensure_index_config(self, logstore_name: str) -> None:
        """
        Ensure index configuration includes all Dify-required fields.

        This method intelligently manages index configuration:
        1. If index doesn't exist, create it with Dify's required fields
        2. If index exists:
           - Check if all Dify-required fields are present
           - Check if field types match requirements
           - Only update if fields are missing or types are incorrect
           - Preserve any additional custom index configurations

        This approach allows users to add their own custom indexes without being overwritten.
        """
        # Get Dify's required field indexes
        required_keys = {}
        if logstore_name == AliyunLogStore.workflow_execution_logstore:
            required_keys = self._get_workflow_execution_index_keys()
        elif logstore_name == AliyunLogStore.workflow_node_execution_logstore:
            required_keys = self._get_workflow_node_execution_index_keys()

        # Check if index exists
        existing_config = self.get_existing_index_config(logstore_name)

        if existing_config is None:
            # Index doesn't exist, create it
            logger.info(
                "Logstore %s: Index doesn't exist, creating with %d required fields",
                logstore_name,
                len(required_keys),
            )
            self.create_index(logstore_name)
        else:
            merged_config, needs_update = self._merge_index_configs(existing_config, required_keys, logstore_name)

            if needs_update:
                logger.info("Logstore %s: Updating index to include Dify-required fields", logstore_name)
                try:
                    self.client.update_index(self.project_name, logstore_name, merged_config)
                    logger.info(
                        "Logstore %s: Index updated successfully, now has %d total field indexes",
                        logstore_name,
                        len(merged_config.key_config_list or {}),
                    )
                except LogException as e:
                    logger.exception(
                        "Failed to update index for logstore %s: errorCode=%s, errorMessage=%s, requestId=%s",
                        logstore_name,
                        e.get_error_code(),
                        e.get_error_message(),
                        e.get_request_id(),
                    )
                    raise
            else:
                logger.info(
                    "Logstore %s: Index already contains all %d Dify-required fields with correct types, "
                    "no update needed",
                    logstore_name,
                    len(required_keys),
                )

    def put_log(self, logstore: str, contents: Sequence[tuple[str, str]]) -> None:
        # Route to PG or SDK based on protocol availability
        if self._use_pg_protocol and self._pg_client:
            self._pg_client.put_log(logstore, contents, self.log_enabled)
        else:
            log_item = LogItem(contents=contents)
            request = PutLogsRequest(project=self.project_name, logstore=logstore, logitems=[log_item])

            if self.log_enabled:
                logger.info(
                    "[LogStore-SDK] PUT_LOG | logstore=%s | project=%s | items_count=%d",
                    logstore,
                    self.project_name,
                    len(contents),
                )

            try:
                self.client.put_logs(request)
            except LogException as e:
                logger.exception(
                    "Failed to put logs to logstore %s: errorCode=%s, errorMessage=%s, requestId=%s",
                    logstore,
                    e.get_error_code(),
                    e.get_error_message(),
                    e.get_request_id(),
                )
                raise

    def get_logs(
        self,
        logstore: str,
        from_time: int,
        to_time: int,
        topic: str = "",
        query: str = "",
        line: int = 100,
        offset: int = 0,
        reverse: bool = True,
    ) -> list[dict]:
        request = GetLogsRequest(
            project=self.project_name,
            logstore=logstore,
            fromTime=from_time,
            toTime=to_time,
            topic=topic,
            query=query,
            line=line,
            offset=offset,
            reverse=reverse,
        )

        if self.log_enabled:
            logger.info(
                "[LogStore] GET_LOGS | logstore=%s | project=%s | query=%s | "
                "from_time=%d | to_time=%d | line=%d | offset=%d | reverse=%s",
                logstore,
                self.project_name,
                query,
                from_time,
                to_time,
                line,
                offset,
                reverse,
            )

        try:
            response = self.client.get_logs(request)
            result = []
            logs = response.get_logs() if response else []
            for log in logs:
                result.append(log.get_contents())

            if self.log_enabled:
                logger.info(
                    "[LogStore] GET_LOGS RESULT | logstore=%s | returned_count=%d",
                    logstore,
                    len(result),
                )

            return result
        except LogException as e:
            logger.exception(
                "Failed to get logs from logstore %s with query '%s': errorCode=%s, errorMessage=%s, requestId=%s",
                logstore,
                query,
                e.get_error_code(),
                e.get_error_message(),
                e.get_request_id(),
            )
            raise

    def execute_sql(
        self,
        sql: str,
        logstore: str | None = None,
        query: str = "*",
        from_time: int | None = None,
        to_time: int | None = None,
        power_sql: bool = False,
    ) -> list[dict]:
        """
        Execute SQL query for aggregation and analysis.

        Args:
            sql: SQL query string (SELECT statement)
            logstore: Name of the logstore (required)
            query: Search/filter query for SDK mode (default: "*" for all logs).
                   Only used in SDK mode. PG mode ignores this parameter.
            from_time: Start time (Unix timestamp) - only used in SDK mode
            to_time: End time (Unix timestamp) - only used in SDK mode
            power_sql: Whether to use enhanced SQL mode (default: False)

        Returns:
            List of result rows as dictionaries

        Note:
            - PG mode: Only executes the SQL directly
            - SDK mode: Combines query and sql as "query | sql"
        """
        # Logstore is required
        if not logstore:
            raise ValueError("logstore parameter is required for execute_sql")

        # Route to PG or SDK based on protocol availability
        if self._use_pg_protocol and self._pg_client:
            # PG mode: execute SQL directly (ignore query parameter)
            return self._pg_client.execute_sql(sql, logstore, self.log_enabled)
        else:
            # SDK mode: combine query and sql as "query | sql"
            full_query = f"{query} | {sql}"

            # Provide default time range if not specified
            if from_time is None:
                from_time = 0

            if to_time is None:
                to_time = int(time.time())  # now

            request = GetLogsRequest(
                project=self.project_name,
                logstore=logstore,
                fromTime=from_time,
                toTime=to_time,
                query=full_query,
            )

            if self.log_enabled:
                logger.info(
                    "[LogStore-SDK] EXECUTE_SQL | logstore=%s | project=%s | from_time=%d | to_time=%d | full_query=%s",
                    logstore,
                    self.project_name,
                    from_time,
                    to_time,
                    full_query,
                )

            try:
                response = self.client.get_logs(request)

                result = []
                logs = response.get_logs() if response else []
                for log in logs:
                    result.append(log.get_contents())

                if self.log_enabled:
                    logger.info(
                        "[LogStore-SDK] EXECUTE_SQL RESULT | logstore=%s | returned_count=%d",
                        logstore,
                        len(result),
                    )

                return result
            except LogException as e:
                logger.exception(
                    "Failed to execute SQL, logstore %s: errorCode=%s, errorMessage=%s, requestId=%s, full_query=%s",
                    logstore,
                    e.get_error_code(),
                    e.get_error_message(),
                    e.get_request_id(),
                    full_query,
                )
                raise


if __name__ == "__main__":
    aliyun_logstore = AliyunLogStore()
    # aliyun_logstore.init_project_logstore()
    aliyun_logstore.put_log(AliyunLogStore.workflow_execution_logstore, [("key1", "value1")])
