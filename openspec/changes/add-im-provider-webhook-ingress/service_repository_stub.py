"""Reference stubs for the IM provider webhook ingress change.

This file documents placement and interface shape only. It must not be imported
by runtime code.

Move the repository-owned declarations to:
    api/repositories/human_input_v2/im_channel_repository.py

Place the SQLAlchemy implementation in:
    api/repositories/human_input_v2/sqlalchemy_im_channel_repository.py

Move the Provider builder declaration to:
    api/services/human_input_v2/im_provider_builder.py

Move the ingress service declaration to:
    api/services/human_input_v2/im_webhook_ingress_service.py

Do not re-export these declarations from package ``__init__.py`` files.
"""

from dataclasses import dataclass
from typing import Protocol

from core.human_input_v2.im_integration.adapters import IMProviderAdapter, WebhookRequest, WebhookResponse
from core.human_input_v2.shared import DeploymentScope, WorkspaceScope
from repositories.human_input_v2.im_channel_repository import IMChannel, WebhookId
from services.human_input_v2.im_credential_codec import BoundCredentialCipher


# Target: api/repositories/human_input_v2/im_channel_repository.py
@dataclass(frozen=True, slots=True)
class IMWebhookChannelRoute:
    """A detached current Channel with its validated credential scope."""

    channel: IMChannel
    credential_scope: WorkspaceScope | DeploymentScope


# Target: api/repositories/human_input_v2/im_channel_repository.py
class IMWebhookChannelRepository(Protocol):
    """Load the current Channel without exposing persistence owner keys."""

    def find_by_webhook_id(
        self,
        webhook_id: WebhookId,
    ) -> IMWebhookChannelRoute | None:
        """Return a detached route, or None when no current route exists.

        Implementations must validate the persisted owner key at the database
        boundary. Query, mapping, and persisted-value failures must raise
        rather than return None.

        Implementations must not decrypt credentials, construct provider
        adapters, access the inbox, or return ORM objects.
        """
        ...


# Target: api/services/human_input_v2/im_provider_builder.py
class IMProviderBuilder(Protocol):
    """Construct provider adapters from Channels using one bound cipher.

    Implementations must recover and validate the Channel credentials through
    ``IMCredentialCodec`` before calling ``build_im_provider_adapter``. They
    must not accept a Webhook route, credential scope, or owner identity.

    Every call returns a new adapter. The caller owns and closes that adapter.
    """

    def __init__(self, cipher: BoundCredentialCipher) -> None:
        """Bind the Builder to one credential owner before use."""
        ...

    def build(self, channel: IMChannel) -> IMProviderAdapter:
        """Return one new credential-bound adapter for the Channel."""
        ...


# Target: api/services/human_input_v2/im_webhook_ingress_service.py
class IMWebhookIngressService:
    """Resolve and invoke one request-scoped provider webhook handler.

    The implementation may depend on the route repository and one private
    credential-scope-to-Builder resolver. Cipher, key-provider, inbox, clock,
    wakeup, and metrics dependencies must remain hidden behind that private
    composition boundary.

    The service must not parse Flask requests, manage database sessions, cache
    adapters or handlers, or define a dedicated telemetry protocol.
    """

    def handle(
        self,
        webhook_id: WebhookId,
        request: WebhookRequest,
    ) -> WebhookResponse:
        """Return the provider response or a uniform empty 404/503 response.

        A missing route or unavailable handler must return 404. Expected
        repository or handler-composition failures must return 503. Conditional
        blueprint registration enforces deployment transport mode before this
        service can be called.

        Each admitted request must create and close one adapter. Its handler
        must use a durable inbox sink bound to the current Channel ID, provider,
        and provider tenant. Provider WebhookResponse values pass through
        unchanged. Application composition registers the callback blueprint
        only when deployment transport mode is WEBHOOK.
        """
        ...
