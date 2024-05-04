from core.tools.entities.user_entities import UserTool, UserToolProvider


class WorkflowToolManageService:
    """
    Service class for managing workflow tools.
    """
    @classmethod
    def create_workflow_tool(cls, user_id: str, tenant_id: str, workflow_app_od: str, 
                             name: str, icon: dict, description: str, 
                             parameters: list[dict]) -> dict:
        """
        Create a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param tool: the tool
        :return: the created tool
        """
        pass

    @classmethod
    def update_workflow_tool(cls, user_id: str, tenant_id: str, workflow_app_id: str, 
                             name: str, icon: dict, description: str, 
                             parameters: list[dict]) -> dict:
        """
        Update a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param tool: the tool
        :return: the updated tool
        """
        pass

    @classmethod
    def list_workflow_tools(cls, user_id: str, tenant_id: str) -> list[UserToolProvider]:
        """
        List workflow tools.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :return: the list of tools
        """
        pass

    @classmethod
    def delete_workflow_tool(cls, user_id: str, tenant_id: str, workflow_app_id: str) -> dict:
        """
        Delete a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        """
        pass

    @classmethod
    def get_workflow_tool(cls, user_id: str, tenant_id: str, workflow_app_id: str) -> UserTool:
        """
        Get a workflow tool.
        :param user_id: the user id
        :param tenant_id: the tenant id
        :param workflow_app_id: the workflow app id
        :return: the tool
        """
        pass