"""Compose human-input debug dependencies."""

from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import DatabaseFileAccessController
from extensions.application_services.workflow_variables import build_workflow_variable_service
from repositories.human_input.form_repository import HumanInputFormRepositoryImpl, HumanInputFormSubmissionRepository
from repositories.workflow.definition_repository import WorkflowDefinitionRepository
from services.human_input.debug_service import HumanInputDebugService
from services.human_input.file_gateway import HumanInputDebugFileGateway
from services.human_input_delivery_test_service import (
    DeliveryTestRegistry,
    EmailDeliveryTestHandler,
    HumanInputDeliveryTestService,
)
from services.human_input_service import HumanInputService


def build_human_input_debug_service(*, database_client: sessionmaker[Session]) -> HumanInputDebugService:
    return HumanInputDebugService(
        definitions=WorkflowDefinitionRepository(session_factory=database_client),
        variables=build_workflow_variable_service(database_client=database_client),
        files=HumanInputDebugFileGateway(sessions=database_client, access=DatabaseFileAccessController()),
        submissions=HumanInputService(
            session_factory=database_client,
            form_repository=HumanInputFormSubmissionRepository(sessions=database_client),
        ),
        forms=partial(HumanInputFormRepositoryImpl, sessions=database_client),
        delivery=HumanInputDeliveryTestService(DeliveryTestRegistry([EmailDeliveryTestHandler(database_client)])),
    )
