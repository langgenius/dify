import logging
import os
import time

from aliyun.log import GetLogsRequest, IndexConfig, IndexLineConfig, LogClient, LogItem, PutLogsRequest
from aliyun.log.auth import AUTH_VERSION_4
from aliyun.log.logexception import LogException
from dotenv import load_dotenv

logger = logging.getLogger(__name__)


class AliyunLogStore:
    project_des = "dify"

    workflow_execution_logstore = "workflow_execution"

    workflow_node_execution_logstore = "workflow_node_execution"

    # todo: init upon Dify startup.
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
            logger.error(
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
                    logger.error(
                        "Failed to create logstore %s: errorCode=%s, errorMessage=%s, requestId=%s",
                        logstore_name,
                        e.get_error_code(),
                        e.get_error_message(),
                        e.get_request_id(),
                    )
                    raise

            if not self.is_index_exist(logstore_name):
                self.create_index(logstore_name)

    def is_index_exist(self, logstore_name: str) -> bool:
        try:
            res = self.client.get_index_config(self.project_name, logstore_name)
            return True
        except Exception as e:
            if e.args[0] == "IndexConfigNotExist":
                return False
            else:
                raise e

    def create_index(self, logstore_name: str) -> None:
        line_config = IndexLineConfig()
        index_config = IndexConfig(line_config=line_config)

        try:
            self.client.create_index(self.project_name, logstore_name, index_config)
            logger.info("index for %s created successfully", logstore_name)
        except LogException as e:
            logger.error(
                "Failed to create index for logstore %s: errorCode=%s, errorMessage=%s, requestId=%s",
                logstore_name,
                e.get_error_code(),
                e.get_error_message(),
                e.get_request_id(),
            )
            raise

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
            logger.error(
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
            logger.error(
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
            logger.error(
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
