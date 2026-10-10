from sqlalchemy import delete
from sqlalchemy.orm import Session

from core.tools.__base.tool_provider import ToolProviderController
from core.tools.entities.tool_entities import ToolProviderType
from core.tools.entities.values import default_tool_label_name_list
from models.tools import ToolLabelBinding
from services.tools.workflow.contracts import StoredToolProvider


class ToolLabelManager:
    @classmethod
    def filter_tool_labels(cls, tool_labels: list[str]) -> list[str]:
        """
        Filter tool labels
        """
        tool_labels = [label for label in tool_labels if label in default_tool_label_name_list]
        return list(set(tool_labels))

    @classmethod
    def update_tool_labels(cls, controller: ToolProviderController, labels: list[str], session: Session) -> None:
        """
        Update tool labels

        :param controller: tool provider controller
        :param labels: list of tool labels
        :param session: caller-owned transaction that also persists the provider
        :return: None
        """

        labels = cls.filter_tool_labels(labels)

        if isinstance(controller, StoredToolProvider) and controller.provider_type in (
            ToolProviderType.API,
            ToolProviderType.WORKFLOW,
        ):
            provider_id = controller.provider_id
        else:
            raise ValueError("Unsupported tool type")

        # delete old labels
        _ = session.execute(
            delete(ToolLabelBinding).where(
                ToolLabelBinding.tool_id == provider_id, ToolLabelBinding.tool_type == controller.provider_type
            )
        )

        # insert new labels
        for label in labels:
            session.add(ToolLabelBinding(tool_id=provider_id, tool_type=controller.provider_type, label_name=label))
