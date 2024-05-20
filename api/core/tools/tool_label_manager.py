from core.tools.entities.default import default_tool_label_list
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.provider.api_tool_provider import ApiToolProviderController
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController
from core.tools.provider.tool_provider import ToolProviderController
from core.tools.provider.workflow_tool_provider import WorkflowToolProviderController
from extensions.ext_database import db
from models.tools import ToolLabelBind


class ToolLabelManager:
    @classmethod
    def filter_tool_labels(cls, tool_labels: list[str]) -> list[str]:
        """
        Filter tool labels
        """
        tool_labels = [label for label in tool_labels if label in default_tool_label_list]
        return list(set(tool_labels))
    
    @classmethod
    def update_tool_labels(cls, controller: ToolProviderController, labels: list[str]):
        """
        Update tool labels
        """
        labels = cls.filter_tool_labels(labels)

        if isinstance(controller, ApiToolProviderController | WorkflowToolProviderController):
            provider_id = controller.provider_id
        else:
            raise ValueError('Unsupported tool type')

        # delete old labels
        db.session.query(ToolLabelBind).filter(
            ToolLabelBind.tool_id == provider_id
        ).delete()

        # insert new labels
        for label in labels:
            db.session.add(ToolLabelBind(
                tool_id=provider_id,
                tool_type=ToolProviderType.API.value,
                label_name=label,
            ))

        db.session.commit()

    @classmethod
    def get_tool_labels(cls, controller: ToolProviderController) -> list[str]:
        """
        Get tool labels
        """
        if isinstance(controller, ApiToolProviderController | WorkflowToolProviderController):
            provider_id = controller.provider_id
        elif isinstance(controller, BuiltinToolProviderController):
            return controller.tool_labels
        else:
            raise ValueError('Unsupported tool type')

        labels: list[ToolLabelBind] = db.session.query(ToolLabelBind.label_name).filter(
            ToolLabelBind.tool_id == provider_id
        ).all()

        return [label.label_name for label in labels]

    @classmethod
    def get_tools_labels(cls, tool_providers: list[ToolProviderController]) -> dict[str, list[str]]:
        """
        Get tools labels

        :param tool_providers: list of tool providers

        :return: dict of tool labels
            :key: tool id
            :value: list of tool labels
        """
        if not tool_providers:
            return {}
        
        for controller in tool_providers:
            if not isinstance(controller, ApiToolProviderController | WorkflowToolProviderController):
                raise ValueError('Unsupported tool type')
            
        provider_ids = [controller.provider_id for controller in tool_providers]

        labels: list[ToolLabelBind] = db.session.query(ToolLabelBind).filter(
            ToolLabelBind.tool_id.in_(provider_ids)
        ).all()

        tool_labels = {
            label.tool_id: [] for label in labels
        }

        for label in labels:
            tool_labels[label.tool_id].append(label.label_name)

        return tool_labels