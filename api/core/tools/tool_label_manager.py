from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from core.tools.__base.tool_provider import ToolProviderController
from core.tools.builtin_tool.provider import BuiltinToolProviderController
from core.tools.custom_tool.provider import ApiToolProviderController
from core.tools.entities.values import default_tool_label_name_list
from core.tools.workflow_as_tool.provider import WorkflowToolProviderController
from extensions.ext_database import db
from models.tools import ToolLabelBinding


class ToolLabelManager:
    @classmethod
    def filter_tool_labels(cls, tool_labels: list[str]) -> list[str]:
        """
        Filter tool labels
        """
        tool_labels = [label for label in tool_labels if label in default_tool_label_name_list]
        return list(set(tool_labels))

    @classmethod
    def update_tool_labels(
        cls, controller: ToolProviderController, labels: list[str], session: Session | None = None
    ) -> None:
        """
        Update tool labels

        :param controller: tool provider controller
        :param labels: list of tool labels
        :param session: database session, if None, a new session will be created
        :return: None
        """

        labels = cls.filter_tool_labels(labels)

        if isinstance(controller, ApiToolProviderController | WorkflowToolProviderController):
            provider_id = controller.provider_id
        else:
            raise ValueError("Unsupported tool type")

        if session is not None:
            cls._update_tool_labels_logics(session, provider_id, controller, labels)
        else:
            with sessionmaker(db.engine).begin() as _session:
                cls._update_tool_labels_logics(_session, provider_id, controller, labels)

    @classmethod
    def _update_tool_labels_logics(
        cls, session: Session, provider_id: str, controller: ToolProviderController, labels: list[str]
    ) -> None:
        """
        Update tool labels logics

        :param session: database session
        :param provider_id: tool provider ID
        :param controller: tool provider controller
        :param labels: list of tool labels
        :return: None
        """

        # delete old labels
        _ = session.execute(
            delete(ToolLabelBinding).where(
                ToolLabelBinding.tool_id == provider_id, ToolLabelBinding.tool_type == controller.provider_type
            )
        )

        # insert new labels
        for label in labels:
            session.add(ToolLabelBinding(tool_id=provider_id, tool_type=controller.provider_type, label_name=label))

    @classmethod
    def get_tool_labels(cls, controller: ToolProviderController) -> list[str]:
        """
        Get tool labels

        :param controller: tool provider controller
        :return: list of tool labels (str)
        """

        if isinstance(controller, ApiToolProviderController | WorkflowToolProviderController):
            provider_id = controller.provider_id
        elif isinstance(controller, BuiltinToolProviderController):
            return controller.tool_labels
        else:
            raise ValueError("Unsupported tool type")
        stmt = select(ToolLabelBinding.label_name).where(
            ToolLabelBinding.tool_id == provider_id,
            ToolLabelBinding.tool_type == controller.provider_type,
        )

        with sessionmaker(db.engine, expire_on_commit=False).begin() as _session:
            labels: list[str] = list(_session.scalars(stmt).all())

        return labels

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

        provider_ids: list[str] = []
        provider_types: set[str] = set()

        for controller in tool_providers:
            if not isinstance(controller, ApiToolProviderController | WorkflowToolProviderController):
                raise ValueError("Unsupported tool type")
            provider_ids.append(controller.provider_id)
            provider_types.add(controller.provider_type)

        labels: list[ToolLabelBinding] = []

        with sessionmaker(db.engine, expire_on_commit=False).begin() as _session:
            stmt = select(ToolLabelBinding).where(
                ToolLabelBinding.tool_id.in_(provider_ids), ToolLabelBinding.tool_type.in_(list(provider_types))
            )
            labels = list(_session.scalars(stmt).all())

        tool_labels: dict[str, list[str]] = {label.tool_id: [] for label in labels}

        for label in labels:
            tool_labels[label.tool_id].append(label.label_name)

        return tool_labels
