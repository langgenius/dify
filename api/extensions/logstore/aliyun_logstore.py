import logging
import os
import time
from typing import Any

import sqlalchemy as sa
from aliyun.log import GetLogsRequest, IndexConfig, IndexKeyConfig, IndexLineConfig, LogClient, LogItem, PutLogsRequest
from aliyun.log.auth import AUTH_VERSION_4
from aliyun.log.logexception import LogException
from dotenv import load_dotenv
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)


class AliyunLogStore:
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
                # - text fields: case_insensitive for better search
                # - all fields: doc_value=True for analytics
                if logstore_type == "text":
                    index_keys[column_name] = IndexKeyConfig(
                        index_type=logstore_type, case_sensitive=False, doc_value=True
                    )
                else:
                    index_keys[column_name] = IndexKeyConfig(index_type=logstore_type, doc_value=True)

        # Add log_version field (not in PG model, but used in logstore for versioning)
        index_keys["log_version"] = IndexKeyConfig(index_type="text", case_sensitive=False, doc_value=True)

        return index_keys

    def __init__(self) -> None:
        load_dotenv()

        access_key_id: str = os.environ.get("ALIYUN_SLS_ACCESS_KEY_ID", "")
        access_key_secret: str = os.environ.get("ALIYUN_SLS_ACCESS_KEY_SECRET", "")
        endpoint: str = os.environ.get("ALIYUN_SLS_ENDPOINT", "")
        region: str = os.environ.get("ALIYUN_SLS_REGION", "")

        self.project_name: str = os.environ.get("ALIYUN_SLS_PROJECT_NAME", "")
        self.logstore_ttl: int = int(os.environ.get("ALIYUN_SLS_LOGSTORE_TTL", 3650))
        self.log_enabled: bool = os.environ.get("SQLALCHEMY_ECHO", "false").lower() == "true"

        self.client = LogClient(endpoint, access_key_id, access_key_secret, auth_version=AUTH_VERSION_4, region=region)

    def init_project_logstore(self):
        """
        Check, create, and update project/logstore/index
        """
        if not self.is_project_exist():
            self.create_project()
        self.create_logstore_if_not_exist()

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
            res = self.client.get_logstore(self.project_name, logstore_name)
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
            res = self.client.get_index_config(self.project_name, logstore_name)
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
            index_type="text", case_sensitive=False, doc_value=True
        )  # Maps to 'error' in PG
        index_keys["started_at"] = IndexKeyConfig(
            index_type="text", case_sensitive=False, doc_value=True
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

        logger.info(
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
        # Create full-text index (line config)
        line_config = IndexLineConfig()

        # Get field index configuration based on logstore name
        field_keys = {}
        if logstore_name == AliyunLogStore.workflow_execution_logstore:
            field_keys = self._get_workflow_execution_index_keys()
        elif logstore_name == AliyunLogStore.workflow_node_execution_logstore:
            field_keys = self._get_workflow_node_execution_index_keys()

        # Convert field_keys dict to list of (key_name, key_config) tuples for IndexConfig
        key_config_list = [(key_name, key_config) for key_name, key_config in field_keys.items()]

        # Create index config with both line and field indexes
        return IndexConfig(line_config=line_config, key_config_list=key_config_list)

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
                len(index_config.key_config_list or []),
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
        3. Updates fields where type doesn't match
        4. Corrects case mismatches (e.g., if Dify needs 'status' but logstore has 'Status')

        Note: Logstore is case-sensitive and doesn't allow duplicate fields with different cases.
        Case mismatch means: existing field name differs from required name only in case.

        Args:
            existing_config: Current index configuration from logstore
            required_keys: Dify's required field index configurations
            logstore_name: Name of the logstore (for logging)

        Returns:
            Tuple of (merged_config, needs_update)
        """
        # Convert existing key_config_list to dict for easier processing
        existing_keys = {}
        if existing_config.key_config_list:
            for key_name, key_config in existing_config.key_config_list:
                existing_keys[key_name] = key_config

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
                if existing_type != required_type:
                    type_mismatches.append((required_name, existing_type, required_type))
                    # Update with correct type
                    existing_keys[required_name] = required_config
                    needs_update = True
                # else: field exists with correct type, no action needed
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
        merged_key_config_list = list(existing_keys.items())
        merged_config = IndexConfig(
            line_config=existing_config.line_config or IndexLineConfig(), key_config_list=merged_key_config_list
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
            # Index exists, merge intelligently
            merged_config, needs_update = self._merge_index_configs(existing_config, required_keys, logstore_name)

            if needs_update:
                logger.info("Logstore %s: Updating index to include Dify-required fields", logstore_name)
                try:
                    self.client.update_index(self.project_name, logstore_name, merged_config)
                    logger.info(
                        "Logstore %s: Index updated successfully, now has %d total field indexes",
                        logstore_name,
                        len(merged_config.key_config_list or []),
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

    def put_log(self, logstore: str, contents: list[tuple[str, str]]) -> None:
        log_item = LogItem(contents=contents)
        request = PutLogsRequest(project=self.project_name, logstore=logstore, logitems=[log_item])

        if self.log_enabled:
            logger.info(
                "[LogStore] PUT_LOG | logstore=%s | project=%s | items_count=%d",
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

        # Log query info if SQLALCHEMY_ECHO is enabled
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
            for log in response.get_logs():
                result.append(log.get_contents())

            # Log result count if SQLALCHEMY_ECHO is enabled
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
        query: str,
        logstore: str | None = None,
        from_time: int | None = None,
        to_time: int | None = None,
        power_sql: bool = False,
    ) -> list[dict]:
        """
        Execute SQL query for aggregation and analysis.

        Args:
            query: SQL query string
            logstore: Name of the logstore (optional, can be specified in FROM clause)
            from_time: Start time (Unix timestamp)
            to_time: End time (Unix timestamp)
            power_sql: Whether to use enhanced SQL mode (default: False)

        Returns:
            List of result rows as dictionaries
        """
        # Logstore is required by the SDK
        if not logstore:
            raise ValueError("logstore parameter is required for execute_sql")

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
            query=query,
        )

        # Log query info if SQLALCHEMY_ECHO is enabled
        if self.log_enabled:
            logger.info(
                "[LogStore] EXECUTE_SQL | logstore=%s | project=%s | from_time=%d | to_time=%d | query=%s",
                logstore,
                self.project_name,
                from_time,
                to_time,
                query,
            )

        try:
            response = self.client.get_logs(request)

            result = []
            for log in response.get_logs():
                result.append(log.get_contents())

            # Log result count if SQLALCHEMY_ECHO is enabled
            if self.log_enabled:
                logger.info(
                    "[LogStore] EXECUTE_SQL RESULT | logstore=%s | returned_count=%d",
                    logstore,
                    len(result),
                )

            return result
        except LogException as e:
            logger.exception(
                "Failed to execute SQL query on logstore %s: errorCode=%s, errorMessage=%s, requestId=%s, query=%s",
                logstore,
                e.get_error_code(),
                e.get_error_message(),
                e.get_request_id(),
                query,
            )
            raise


if __name__ == "__main__":
    aliyun_logstore = AliyunLogStore()
    # aliyun_logstore.init_project_logstore()
    aliyun_logstore.put_log(AliyunLogStore.workflow_execution_logstore, [("key1", "value1")])
