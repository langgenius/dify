import logging
import os

from aliyun.log import IndexConfig, IndexLineConfig, LogClient, LogItem, PutLogsRequest
from aliyun.log.auth import AUTH_VERSION_4
from dotenv import load_dotenv

logger = logging.getLogger(__name__)


class AliyunLogStore:

    project_des = "dify"

    workflow_execution_logstore = "workflow_execution"

    workflow_node_execution_logstore = "workflow_node_execution"


    def __init__(self) -> None:
        load_dotenv()

        access_key_id:str = os.environ.get('ALIYUN_SLS_ACCESS_KEY_ID', '')
        access_key_secret:str = os.environ.get('ALIYUN_SLS_ACCESS_KEY_SECRET', '')
        endpoint:str = os.environ.get('ALIYUN_SLS_ENDPOINT', '')
        region:str = os.environ.get('ALIYUN_SLS_REGION', '')

        self.project_name:str = os.environ.get('ALIYUN_SLS_PROJECT_NAME', '')
        self.logstore_ttl:int = int(os.environ.get('ALIYUN_SLS_LOGSTORE_TTL', 3650))

        self.client = LogClient(endpoint, access_key_id, access_key_secret, auth_version=AUTH_VERSION_4,region=region)

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
            if e.args[0] == 'ProjectNotExist':
                return False
            else:
                raise e

    def create_project(self):
        self.client.create_project(self.project_name, AliyunLogStore.project_des)
        logger.info("Project %s created successfully", self.project_name)

    def is_logstore_exist(self,logstore_name:str) -> bool:
        try:
            res = self.client.get_logstore(self.project_name,logstore_name)
            return True
        except Exception as e:
            if e.args[0] == 'LogStoreNotExist':
                return False
            else:
                raise e

    def create_logstore_if_not_exist(self) -> None:
        logstore_name_list = [
            AliyunLogStore.workflow_execution_logstore,AliyunLogStore.workflow_node_execution_logstore]

        for logstore_name in logstore_name_list:
            if not self.is_logstore_exist(logstore_name):
                self.client.create_logstore(
                    project_name=self.project_name,
                    logstore_name=logstore_name,
                    ttl=self.logstore_ttl
                )
                logger.info("logstore %s created successfully", logstore_name)

            if not self.is_index_exist(logstore_name):
                self.create_index(logstore_name)

    def is_index_exist(self,logstore_name:str) -> bool:
        try:
            res = self.client.get_index_config(self.project_name,logstore_name)
            return True
        except Exception as e:
            if e.args[0] == 'IndexConfigNotExist':
                return False
            else:
                raise e

    def create_index(self,logstore_name:str) -> None:
        line_config = IndexLineConfig()
        index_config = IndexConfig(line_config=line_config)

        self.client.create_index(self.project_name, logstore_name,index_config)
        logger.info("index for %s created successfully", logstore_name)

    def put_log(self,logstore:str,contents:list[tuple[str,str]]) -> None:
        log_item = LogItem(contents=contents)
        request = PutLogsRequest(project=self.project_name, logstore=logstore,logitems=[log_item])
        self.client.put_logs(request)


if __name__ == '__main__':
    aliyun_logstore = AliyunLogStore()
    # aliyun_logstore.init_project_logstore()
    aliyun_logstore.put_log(AliyunLogStore.workflow_execution_logstore,[('key1','value1')])
