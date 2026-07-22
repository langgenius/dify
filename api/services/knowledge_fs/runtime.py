"""Composition root for the independent KnowledgeFS product services."""

from __future__ import annotations

from typing import NamedTuple

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from repositories.sqlalchemy_knowledge_fs_capability_issuance_auditor import (
    SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor,
)
from services.knowledge_fs.app_admission_service import KnowledgeFSAppAdmissionService
from services.knowledge_fs.app_binding_management import (
    KnowledgeFSAppBindingManagementService,
    SQLKnowledgeFSAppCatalog,
)
from services.knowledge_fs.app_execution_capability import KnowledgeFSAppExecutionCapabilityService
from services.knowledge_fs.batch_capability import KnowledgeFSBatchCapabilityBroker
from services.knowledge_fs.capability_broker import KnowledgeFSCapabilityBroker
from services.knowledge_fs.control_plane_service import (
    KnowledgeFSControlPlaneService,
    SQLKnowledgeFSWorkspaceMemberPort,
)
from services.knowledge_fs.control_space_commands import KnowledgeFSControlSpaceCommandService
from services.knowledge_fs.credential_service import KnowledgeFSCredentialService
from services.knowledge_fs.cutover_runtime_gate import SQLKnowledgeFSWorkspaceRuntimeGate
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.operation_admission import (
    DifyKnowledgeFSBillingPort,
    DifyKnowledgeFSWeightedRateLimitPort,
    KnowledgeFSDirectOperationAdmissionService,
    KnowledgeFSOperationAdmissionService,
    LoggingKnowledgeFSRateLimitAudit,
)
from services.knowledge_fs.product_application_service import KnowledgeFSProductApplicationService
from services.knowledge_fs.product_authorization import DifyKnowledgeFSProductRBACPort
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from services.knowledge_fs.product_remote_http import HTTPKnowledgeFSProductRemoteClient
from services.knowledge_fs.product_service import KnowledgeFSProductService
from services.knowledge_fs.revocation_commands import KnowledgeFSRevocationCommandProducer
from services.knowledge_fs_capability import create_configured_knowledge_fs_capability_issuer


class KnowledgeFSRuntime(NamedTuple):
    application: KnowledgeFSProductApplicationService
    app_admission: KnowledgeFSAppAdmissionService
    app_bindings: KnowledgeFSAppBindingManagementService
    app_capabilities: KnowledgeFSAppExecutionCapabilityService
    broker: KnowledgeFSCapabilityBroker
    control_plane: KnowledgeFSControlPlaneService
    credentials: KnowledgeFSCredentialService
    direct_operation_admission: KnowledgeFSDirectOperationAdmissionService
    facade: KnowledgeFSDataFacade
    operation_admission: KnowledgeFSOperationAdmissionService


def create_knowledge_fs_runtime(session_maker: sessionmaker[Session]) -> KnowledgeFSRuntime:
    base_url = dify_config.KNOWLEDGE_FS_BASE_URL
    if base_url is None:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS integration is not configured")
    rbac = DifyKnowledgeFSProductRBACPort()
    remote = HTTPKnowledgeFSProductRemoteClient(
        base_url=base_url,
        timeout_seconds=dify_config.KNOWLEDGE_FS_TIMEOUT_SECONDS,
        max_response_bytes=dify_config.KNOWLEDGE_FS_PRODUCT_MAX_RESPONSE_BYTES,
    )
    issuer = create_configured_knowledge_fs_capability_issuer(
        audit=SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor(session_maker)
    )
    cutover_gate = SQLKnowledgeFSWorkspaceRuntimeGate(session_maker)
    batch_capabilities = KnowledgeFSBatchCapabilityBroker(
        session_maker,
        cutover_gate=cutover_gate,
        issuer=issuer,
    )
    product = KnowledgeFSProductService(
        session_maker,
        batch_capabilities=batch_capabilities,
        cutover_gate=cutover_gate,
        remote=remote,
        rbac=rbac,
    )
    revocations = KnowledgeFSRevocationCommandProducer()
    control_plane = KnowledgeFSControlPlaneService(
        session_maker,
        product=product,
        members=SQLKnowledgeFSWorkspaceMemberPort(),
        revocations=revocations,
    )
    broker = KnowledgeFSCapabilityBroker(
        session_maker,
        cutover_gate=cutover_gate,
        product=product,
        issuer=issuer,
    )
    operation_admission = KnowledgeFSOperationAdmissionService(
        rate_limit=DifyKnowledgeFSWeightedRateLimitPort(audit=LoggingKnowledgeFSRateLimitAudit()),
        billing=DifyKnowledgeFSBillingPort(),
    )
    direct_operation_admission = KnowledgeFSDirectOperationAdmissionService(
        admission=operation_admission,
        broker=broker,
    )
    facade = KnowledgeFSDataFacade(admission=operation_admission, broker=broker, remote=remote)
    credentials = KnowledgeFSCredentialService(session_maker, product=product, revocations=revocations)
    application = KnowledgeFSProductApplicationService(
        product=product,
        control_plane=control_plane,
        commands=KnowledgeFSControlSpaceCommandService(session_maker),
        facade=facade,
        rbac=rbac,
    )
    app_admission = KnowledgeFSAppAdmissionService(session_maker, revocations=revocations)
    return KnowledgeFSRuntime(
        application=application,
        app_admission=app_admission,
        app_bindings=KnowledgeFSAppBindingManagementService(
            session_maker,
            product=product,
            apps=SQLKnowledgeFSAppCatalog(),
            revocations=revocations,
        ),
        app_capabilities=KnowledgeFSAppExecutionCapabilityService(
            admission=app_admission,
            broker=broker,
            operation_admission=operation_admission,
            remote=remote,
        ),
        broker=broker,
        control_plane=control_plane,
        credentials=credentials,
        direct_operation_admission=direct_operation_admission,
        facade=facade,
        operation_admission=operation_admission,
    )


__all__ = ["KnowledgeFSRuntime", "create_knowledge_fs_runtime"]
