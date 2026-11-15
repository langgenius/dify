"""Application service for listing current account integrations."""

from collections.abc import Sequence

from machinery.context import RequestContext
from services.account_ports import AccountIntegrationRepository
from services.entities.account_entities import AccountIntegrationStatus


class AccountIntegrationService:
    def __init__(
        self,
        *,
        integrations: AccountIntegrationRepository,
        providers: Sequence[str] = ("github", "google"),
    ) -> None:
        self._integrations = integrations
        self._providers = tuple(providers)

    def list(self, context: RequestContext) -> list[AccountIntegrationStatus]:
        integrations = self._integrations.list_for_account(context.account_id)

        integrations_by_provider = {integration.provider: integration for integration in integrations}
        statuses: list[AccountIntegrationStatus] = []
        for provider in self._providers:
            integration = integrations_by_provider.get(provider)
            statuses.append(
                AccountIntegrationStatus(
                    provider=provider,
                    created_at=integration.created_at if integration else None,
                    is_bound=integration is not None,
                )
            )
        return statuses
