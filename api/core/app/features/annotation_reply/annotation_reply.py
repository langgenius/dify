"""Bridge legacy generation callers to the injected annotation reply service.

TODO: Remove this bridge when generators receive their runtime services explicitly.
Callers must release their database transactions before invoking matching.
"""

from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import App, Message
from services.annotation_reply_service import AnnotationReplyRecord, AnnotationReplySource


class AnnotationReplyFeature:
    def query(
        self,
        app_record: App,
        message: Message,
        query: str,
        user_id: str,
        invoke_from: InvokeFrom,
    ) -> AnnotationReplyRecord | None:
        # Import lazily: the composition root also assembles generation services.
        from extensions.ext_application_services import application_services

        source: AnnotationReplySource = (
            "api" if invoke_from in {InvokeFrom.SERVICE_API, InvokeFrom.WEB_APP} else "console"
        )
        return application_services().annotation_reply.match(
            tenant_id=app_record.tenant_id,
            app_id=app_record.id,
            message_id=message.id,
            user_id=user_id,
            query=query,
            source=source,
        )

    def get_reply(self, *, tenant_id: str, app_id: str, annotation_id: str) -> AnnotationReplyRecord | None:
        from extensions.ext_application_services import application_services

        return application_services().annotation_reply.get_reply(
            tenant_id=tenant_id, app_id=app_id, annotation_id=annotation_id
        )
