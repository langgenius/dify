"""Explicit mapping between Form Core domain values and ORM records.

Every structured JSON value is validated at this boundary. ORM records never
escape into the form domain, and domain mappings are converted to the persisted
Pydantic types explicitly.
"""

from __future__ import annotations

from datetime import datetime
from typing import assert_never

from pydantic import JsonValue, NaiveDatetime, TypeAdapter

from core.human_input_v2 import (
    FileInput,
    FileListInput,
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    SelectInput,
)
from core.human_input_v2.approval import (
    ApprovalSubject,
    ApproverGrant,
    CanonicalSubjectKey,
    ConsoleEndpointConfiguration,
    ContactApprovalSubject,
    DeliveryAttempt,
    DeliveryEndpoint,
    DeliveryEndpointConfiguration,
    EmailAddressApprovalSubject,
    EmailEndpointConfiguration,
    EmailProviderConfiguration,
    EndpointAccessCapability,
    EndUserApprovalSubject,
    FormRef,
    HumanInputForm,
    IMEndpointConfiguration,
    MatchedRecipientSource,
    SubjectSnapshot,
    UploadCapability,
    UploadFileAssociation,
    WebEndpointConfiguration,
)
from core.human_input_v2.entities import HumanInputApproverGrantSubjectType, HumanInputDeliveryChannel
from core.human_input_v2.shared import (
    AppId,
    ApproverGrantId,
    ContactId,
    DeliveryAttemptId,
    DeliveryEndpointId,
    EndUserId,
    FormId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    UploadCapabilityId,
    UploadFileAssociationId,
)
from libs.datetime_utils import ensure_naive_utc
from models.base import DefaultFieldsDCMixin
from models.human_input_v2 import (
    FormApproverGrantMatchedSource,
    FormApproverGrantMatchedSources,
    FormApproverGrantSubjectSnapshot,
    FormDeliveryProviderResponse,
    HumanInputEmailProvider,
    HumanInputV2Form,
    HumanInputV2FormApproverGrant,
    HumanInputV2FormDefinition,
    HumanInputV2FormDeliveryAttempt,
    HumanInputV2FormDeliveryEndpoint,
    HumanInputV2FormUploadFile,
    HumanInputV2FormUploadToken,
    ResolvedFormFileInput,
    ResolvedFormFileListInput,
    ResolvedFormMarkdownText,
    ResolvedFormParagraphInput,
    ResolvedFormSelectInput,
)
from models.human_input_v2 import (
    ResolvedFormAction as ResolvedFormActionRecord,
)
from repositories.human_input_v2.email_channel.mappers import (
    email_provider_from_record as _email_provider_from_record,
)
from repositories.human_input_v2.email_channel.mappers import (
    email_provider_to_record as _email_provider_to_record,
)

_JSON_OBJECT_ADAPTER: TypeAdapter[dict[str, JsonValue]] = TypeAdapter(dict[str, JsonValue])


def _timestamp(value: datetime) -> NaiveDatetime:
    return ensure_naive_utc(value)


def _set_record_identity(
    record: DefaultFieldsDCMixin,
    *,
    record_id: str,
    created_at: NaiveDatetime,
    updated_at: NaiveDatetime,
) -> None:
    # SQLAlchemy's mapped dataclass mixin owns these fields on every record type.
    record.id = record_id
    record.created_at = created_at
    record.updated_at = updated_at


def email_provider_to_record(provider: EmailProviderConfiguration) -> HumanInputEmailProvider:
    """Compatibility import for the repository that now owns Email mapping."""

    return _email_provider_to_record(provider)


def email_provider_from_record(record: HumanInputEmailProvider) -> EmailProviderConfiguration:
    """Compatibility import for the repository that now owns Email mapping."""

    return _email_provider_from_record(record)


def _resolved_form_to_record_value(
    resolved_form: ResolvedForm,
    *,
    display_in_ui: bool | None,
) -> HumanInputV2FormDefinition:
    blocks: list[
        ResolvedFormMarkdownText
        | ResolvedFormParagraphInput
        | ResolvedFormSelectInput
        | ResolvedFormFileInput
        | ResolvedFormFileListInput
    ] = []
    for block in resolved_form.blocks:
        match block:
            case MarkdownText(text=text):
                blocks.append(ResolvedFormMarkdownText(text=text))
            case ParagraphInput(output_variable_name=output_variable_name, default_value=default_value):
                blocks.append(
                    ResolvedFormParagraphInput(
                        output_variable_name=output_variable_name,
                        default_value=default_value,
                    )
                )
            case SelectInput(
                output_variable_name=output_variable_name,
                options=options,
                default_value=default_value,
            ):
                blocks.append(
                    ResolvedFormSelectInput(
                        output_variable_name=output_variable_name,
                        options=options,
                        default_value=default_value,
                    )
                )
            case FileInput(
                output_variable_name=output_variable_name,
                allowed_file_types=allowed_file_types,
                allowed_file_extensions=allowed_file_extensions,
                allowed_file_upload_methods=allowed_file_upload_methods,
            ):
                blocks.append(
                    ResolvedFormFileInput(
                        output_variable_name=output_variable_name,
                        allowed_file_types=allowed_file_types,
                        allowed_file_extensions=allowed_file_extensions,
                        allowed_file_upload_methods=allowed_file_upload_methods,
                    )
                )
            case FileListInput(
                output_variable_name=output_variable_name,
                allowed_file_types=allowed_file_types,
                allowed_file_extensions=allowed_file_extensions,
                allowed_file_upload_methods=allowed_file_upload_methods,
                number_limits=number_limits,
            ):
                blocks.append(
                    ResolvedFormFileListInput(
                        output_variable_name=output_variable_name,
                        allowed_file_types=allowed_file_types,
                        allowed_file_extensions=allowed_file_extensions,
                        allowed_file_upload_methods=allowed_file_upload_methods,
                        number_limits=number_limits,
                    )
                )
            case _:
                assert_never(block)
    return HumanInputV2FormDefinition(
        title=resolved_form.title,
        blocks=tuple(blocks),
        user_actions=tuple(
            ResolvedFormActionRecord(id=action.id, title=action.title, button_style=action.button_style)
            for action in resolved_form.user_actions
        ),
        display_in_ui=display_in_ui,
    )


def _resolved_form_from_record_value(
    definition: HumanInputV2FormDefinition,
    *,
    legacy_form_content: str,
) -> ResolvedForm:
    blocks: list[MarkdownText | ParagraphInput | SelectInput | FileInput | FileListInput] = []
    for block in definition.blocks:
        match block:
            case ResolvedFormMarkdownText(text=text):
                blocks.append(MarkdownText(text))
            case ResolvedFormParagraphInput(
                output_variable_name=output_variable_name,
                default_value=default_value,
            ):
                blocks.append(ParagraphInput(output_variable_name, default_value))
            case ResolvedFormSelectInput(
                output_variable_name=output_variable_name,
                options=options,
                default_value=default_value,
            ):
                blocks.append(SelectInput(output_variable_name, options, default_value))
            case ResolvedFormFileInput(
                output_variable_name=output_variable_name,
                allowed_file_types=allowed_file_types,
                allowed_file_extensions=allowed_file_extensions,
                allowed_file_upload_methods=allowed_file_upload_methods,
            ):
                blocks.append(
                    FileInput(
                        output_variable_name,
                        allowed_file_types,
                        allowed_file_extensions,
                        allowed_file_upload_methods,
                    )
                )
            case ResolvedFormFileListInput(
                output_variable_name=output_variable_name,
                allowed_file_types=allowed_file_types,
                allowed_file_extensions=allowed_file_extensions,
                allowed_file_upload_methods=allowed_file_upload_methods,
                number_limits=number_limits,
            ):
                blocks.append(
                    FileListInput(
                        output_variable_name,
                        allowed_file_types,
                        allowed_file_extensions,
                        allowed_file_upload_methods,
                        number_limits,
                    )
                )
            case _:
                assert_never(block)
    return ResolvedForm(
        title=definition.title,
        blocks=tuple(blocks),
        user_actions=tuple(
            ResolvedFormAction(action.id, action.title, action.button_style) for action in definition.user_actions
        ),
        legacy_form_content=legacy_form_content,
    )


def form_to_record(form: HumanInputForm) -> HumanInputV2Form:
    """Map one form root into a detached record without child side effects."""

    record = HumanInputV2Form(
        tenant_id=str(form.ref.tenant_id),
        app_id=str(form.app_id),
        form_definition=_resolved_form_to_record_value(form.resolved_form, display_in_ui=form.display_in_ui),
        rendered_content=form.resolved_form.legacy_form_content,
        node_timeout_at=form.node_timeout_at,
        global_expires_at=form.global_expires_at,
        form_kind=form.kind,
        status=form.status,
        workflow_pause_id=form.workflow_pause_id,
        node_execution_id=form.node_execution_id,
    )
    _set_record_identity(
        record,
        record_id=str(form.ref.form_id),
        created_at=form.created_at,
        updated_at=form.updated_at,
    )
    return record


def form_from_record(
    record: HumanInputV2Form,
    grant_records: tuple[HumanInputV2FormApproverGrant, ...],
) -> HumanInputForm:
    """Rebuild one lifecycle-ready aggregate from an explicitly loaded grant graph."""

    form_ref = FormRef(TenantId(record.tenant_id), FormId(record.id))
    grants = tuple(grant_from_record(grant_record) for grant_record in grant_records)
    if any(grant.ref.form_ref != form_ref for grant in grants):
        raise ValueError("loaded grant does not belong to the form record")
    return HumanInputForm(
        ref=form_ref,
        app_id=AppId(record.app_id),
        resolved_form=_resolved_form_from_record_value(
            record.form_definition,
            legacy_form_content=record.rendered_content,
        ),
        display_in_ui=record.form_definition.display_in_ui,
        node_timeout_at=_timestamp(record.node_timeout_at),
        global_expires_at=_timestamp(record.global_expires_at),
        kind=record.form_kind,
        status=record.status,
        workflow_pause_id=record.workflow_pause_id,
        node_execution_id=record.node_execution_id,
        grants=grants,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def grant_to_record(grant: ApproverGrant) -> HumanInputV2FormApproverGrant:
    """Map one historical grant into a detached persistence record."""

    contact_id: str | None = None
    end_user_id: str | None = None
    normalized_email: str | None = None
    match grant.subject:
        case ContactApprovalSubject(contact_id=subject_contact_id):
            subject_type = HumanInputApproverGrantSubjectType.CONTACT
            contact_id = str(subject_contact_id)
        case EndUserApprovalSubject(end_user_id=subject_end_user_id):
            subject_type = HumanInputApproverGrantSubjectType.END_USER
            end_user_id = str(subject_end_user_id)
        case EmailAddressApprovalSubject(normalized_email=subject_email):
            subject_type = HumanInputApproverGrantSubjectType.EMAIL_ADDRESS
            normalized_email = str(subject_email)
        case _:
            assert_never(grant.subject)
    record = HumanInputV2FormApproverGrant(
        tenant_id=str(grant.ref.form_ref.tenant_id),
        form_id=str(grant.ref.form_ref.form_id),
        subject_type=subject_type,
        subject_key=grant.subject_key.value,
        matched_sources=FormApproverGrantMatchedSources(
            sources=tuple(
                FormApproverGrantMatchedSource(
                    kind=source.kind,
                    position=source.position,
                    reference=source.reference,
                )
                for source in grant.matched_sources
            )
        ),
        subject_snapshot=FormApproverGrantSubjectSnapshot(
            display_name=grant.subject_snapshot.display_name,
            email=grant.subject_snapshot.email,
        ),
        contact_id=contact_id,
        end_user_id=end_user_id,
        normalized_email=normalized_email,
    )
    _set_record_identity(record, record_id=str(grant.id), created_at=grant.created_at, updated_at=grant.updated_at)
    return record


def grant_from_record(record: HumanInputV2FormApproverGrant) -> ApproverGrant:
    """Map one validated grant record into a historical domain snapshot."""

    subject: ApprovalSubject
    match record.subject_type:
        case HumanInputApproverGrantSubjectType.CONTACT:
            if record.contact_id is None:
                raise ValueError("contact grant record is missing contact_id")
            subject = ContactApprovalSubject(ContactId(record.contact_id))
        case HumanInputApproverGrantSubjectType.END_USER:
            if record.end_user_id is None:
                raise ValueError("end-user grant record is missing end_user_id")
            subject = EndUserApprovalSubject(EndUserId(record.end_user_id))
        case HumanInputApproverGrantSubjectType.EMAIL_ADDRESS:
            if record.normalized_email is None:
                raise ValueError("email grant record is missing normalized_email")
            subject = EmailAddressApprovalSubject(NormalizedEmail(record.normalized_email))
    return ApproverGrant(
        ref=FormRef(TenantId(record.tenant_id), FormId(record.form_id)).grant(ApproverGrantId(record.id)),
        subject=subject,
        subject_key=CanonicalSubjectKey(record.subject_key),
        matched_sources=tuple(
            MatchedRecipientSource(source.kind, source.position, source.reference)
            for source in record.matched_sources.sources
        ),
        subject_snapshot=SubjectSnapshot(
            display_name=record.subject_snapshot.display_name,
            email=record.subject_snapshot.email,
        ),
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def endpoint_to_record(endpoint: DeliveryEndpoint) -> HumanInputV2FormDeliveryEndpoint:
    """Map one discriminated endpoint configuration without raw dictionaries."""

    email_address: str | None = None
    integration_id: str | None = None
    provider = None
    provider_tenant_id: str | None = None
    provider_user_id: str | None = None
    im_identity_id: str | None = None
    im_binding_id: str | None = None
    match endpoint.configuration:
        case EmailEndpointConfiguration(email_address=address):
            email_address = str(address)
        case IMEndpointConfiguration(
            integration_id=integration,
            provider=im_provider,
            provider_tenant_id=tenant_identity,
            identity_id=identity,
            binding_id=binding,
            provider_user_id=user_identity,
        ):
            integration_id = str(integration)
            provider = im_provider
            provider_tenant_id = tenant_identity
            provider_user_id = user_identity
            im_identity_id = str(identity)
            im_binding_id = str(binding) if binding is not None else None
        case WebEndpointConfiguration() | ConsoleEndpointConfiguration():
            pass
        case _:
            assert_never(endpoint.configuration)
    record = HumanInputV2FormDeliveryEndpoint(
        tenant_id=str(endpoint.ref.form_ref.tenant_id),
        form_id=str(endpoint.ref.form_ref.form_id),
        approver_grant_id=str(endpoint.ref.grant_ref.grant_id),
        channel=endpoint.channel,
        address_hash=endpoint.address_hash,
        email_address=email_address,
        integration_id=integration_id,
        provider=provider,
        provider_tenant_id=provider_tenant_id,
        provider_user_id=provider_user_id,
        im_identity_id=im_identity_id,
        im_binding_id=im_binding_id,
        access_token_hash=endpoint.access_capability.token_hash if endpoint.access_capability is not None else None,
    )
    _set_record_identity(
        record, record_id=str(endpoint.id), created_at=endpoint.created_at, updated_at=endpoint.updated_at
    )
    return record


def endpoint_from_record(record: HumanInputV2FormDeliveryEndpoint) -> DeliveryEndpoint:
    """Reject malformed discriminated endpoint records instead of leaking nulls."""

    endpoint_ref = (
        FormRef(TenantId(record.tenant_id), FormId(record.form_id))
        .grant(ApproverGrantId(record.approver_grant_id))
        .endpoint(DeliveryEndpointId(record.id))
    )
    configuration: DeliveryEndpointConfiguration
    match record.channel:
        case HumanInputDeliveryChannel.EMAIL:
            if record.email_address is None:
                raise ValueError("email endpoint record is missing email_address")
            if (
                record.integration_id is not None
                or record.provider is not None
                or record.provider_tenant_id is not None
                or record.provider_user_id is not None
                or record.im_identity_id is not None
                or record.im_binding_id is not None
            ):
                raise ValueError("email endpoint record contains invalid channel configuration")
            configuration = EmailEndpointConfiguration(NormalizedEmail(record.email_address))
        case HumanInputDeliveryChannel.IM:
            if record.email_address is not None:
                raise ValueError("IM endpoint record contains invalid channel configuration")
            if (
                record.integration_id is None
                or record.provider is None
                or record.provider_tenant_id is None
                or record.im_identity_id is None
                or record.provider_user_id is None
            ):
                raise ValueError("IM endpoint record is missing provider configuration")
            configuration = IMEndpointConfiguration(
                integration_id=IntegrationId(record.integration_id),
                provider=record.provider,
                provider_tenant_id=record.provider_tenant_id,
                identity_id=IMIdentityId(record.im_identity_id),
                binding_id=IMBindingId(record.im_binding_id) if record.im_binding_id is not None else None,
                provider_user_id=record.provider_user_id,
            )
        case HumanInputDeliveryChannel.WEB | HumanInputDeliveryChannel.CONSOLE:
            if (
                record.email_address is not None
                or record.integration_id is not None
                or record.provider is not None
                or record.provider_tenant_id is not None
                or record.provider_user_id is not None
                or record.im_identity_id is not None
                or record.im_binding_id is not None
            ):
                raise ValueError(f"{record.channel.value} endpoint record contains invalid channel configuration")
            configuration = (
                WebEndpointConfiguration()
                if record.channel is HumanInputDeliveryChannel.WEB
                else ConsoleEndpointConfiguration()
            )
        case _:
            raise ValueError(f"unsupported delivery channel: {record.channel!r}")
    capability = (
        EndpointAccessCapability(endpoint_ref, record.access_token_hash)
        if record.access_token_hash is not None
        else None
    )
    return DeliveryEndpoint(
        ref=endpoint_ref,
        configuration=configuration,
        address_hash=record.address_hash,
        access_capability=capability,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def delivery_attempt_to_record(attempt: DeliveryAttempt) -> HumanInputV2FormDeliveryAttempt:
    response = (
        FormDeliveryProviderResponse(_JSON_OBJECT_ADAPTER.validate_python(attempt.provider_response))
        if attempt.provider_response is not None
        else None
    )
    record = HumanInputV2FormDeliveryAttempt(
        tenant_id=str(attempt.endpoint_ref.form_ref.tenant_id),
        form_id=str(attempt.endpoint_ref.form_ref.form_id),
        endpoint_id=str(attempt.endpoint_ref.endpoint_id),
        attempt_number=attempt.attempt_number,
        status=attempt.status,
        scheduled_at=attempt.scheduled_at,
        started_at=attempt.started_at if attempt.started_at is not None else None,
        finished_at=attempt.finished_at if attempt.finished_at is not None else None,
        provider_message_id=attempt.provider_message_id,
        failure_code=attempt.failure_code,
        failure_reason=attempt.failure_reason,
        provider_response=response,
    )
    _set_record_identity(
        record, record_id=str(attempt.id), created_at=attempt.created_at, updated_at=attempt.updated_at
    )
    return record


def delivery_attempt_from_record(
    record: HumanInputV2FormDeliveryAttempt,
    endpoint_record: HumanInputV2FormDeliveryEndpoint,
) -> DeliveryAttempt:
    endpoint = endpoint_from_record(endpoint_record)
    if (
        endpoint.ref.form_ref.tenant_id != TenantId(record.tenant_id)
        or endpoint.ref.form_ref.form_id != FormId(record.form_id)
        or endpoint.id != DeliveryEndpointId(record.endpoint_id)
    ):
        raise ValueError("delivery attempt owner does not match its endpoint record")
    return DeliveryAttempt(
        id=DeliveryAttemptId(record.id),
        endpoint_ref=endpoint.ref,
        attempt_number=record.attempt_number,
        status=record.status,
        scheduled_at=_timestamp(record.scheduled_at),
        started_at=_timestamp(record.started_at) if record.started_at is not None else None,
        finished_at=_timestamp(record.finished_at) if record.finished_at is not None else None,
        provider_message_id=record.provider_message_id,
        failure_code=record.failure_code,
        failure_reason=record.failure_reason,
        provider_response=record.provider_response.root if record.provider_response is not None else None,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def upload_capability_to_record(capability: UploadCapability) -> HumanInputV2FormUploadToken:
    record = HumanInputV2FormUploadToken(
        tenant_id=str(capability.endpoint_ref.form_ref.tenant_id),
        app_id=str(capability.app_id),
        form_id=str(capability.endpoint_ref.form_ref.form_id),
        endpoint_id=str(capability.endpoint_ref.endpoint_id),
        upload_token_hash=capability.token_hash,
    )
    _set_record_identity(
        record, record_id=str(capability.id), created_at=capability.created_at, updated_at=capability.updated_at
    )
    return record


def upload_capability_from_record(
    record: HumanInputV2FormUploadToken,
    endpoint_record: HumanInputV2FormDeliveryEndpoint,
) -> UploadCapability:
    endpoint = endpoint_from_record(endpoint_record)
    if (
        endpoint.ref.form_ref.tenant_id != TenantId(record.tenant_id)
        or endpoint.ref.form_ref.form_id != FormId(record.form_id)
        or endpoint.id != DeliveryEndpointId(record.endpoint_id)
    ):
        raise ValueError("upload capability owner does not match its endpoint record")
    return UploadCapability(
        id=UploadCapabilityId(record.id),
        endpoint_ref=endpoint.ref,
        app_id=AppId(record.app_id),
        token_hash=record.upload_token_hash,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )


def upload_file_to_record(association: UploadFileAssociation) -> HumanInputV2FormUploadFile:
    endpoint_ref = association.capability_ref.endpoint_ref
    record = HumanInputV2FormUploadFile(
        tenant_id=str(endpoint_ref.form_ref.tenant_id),
        app_id=str(association.capability_ref.app_id),
        form_id=str(endpoint_ref.form_ref.form_id),
        endpoint_id=str(endpoint_ref.endpoint_id),
        upload_file_id=association.upload_file_id,
        upload_token_id=str(association.capability_ref.capability_id),
    )
    _set_record_identity(
        record,
        record_id=str(association.id),
        created_at=association.created_at,
        updated_at=association.updated_at,
    )
    return record


def upload_file_from_record(
    record: HumanInputV2FormUploadFile,
    capability_record: HumanInputV2FormUploadToken,
    endpoint_record: HumanInputV2FormDeliveryEndpoint,
) -> UploadFileAssociation:
    capability = upload_capability_from_record(capability_record, endpoint_record)
    if (
        capability.id != UploadCapabilityId(record.upload_token_id)
        or capability.endpoint_ref.form_ref.tenant_id != TenantId(record.tenant_id)
        or capability.endpoint_ref.form_ref.form_id != FormId(record.form_id)
        or capability.endpoint_ref.endpoint_id != DeliveryEndpointId(record.endpoint_id)
        or capability.app_id != AppId(record.app_id)
    ):
        raise ValueError("uploaded file owner does not match its capability record")
    return UploadFileAssociation(
        id=UploadFileAssociationId(record.id),
        capability_ref=capability.ref,
        upload_file_id=record.upload_file_id,
        created_at=_timestamp(record.created_at),
        updated_at=_timestamp(record.updated_at),
    )
