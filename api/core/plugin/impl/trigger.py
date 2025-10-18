import binascii
from collections.abc import Generator, Mapping
from typing import Any

from flask import Request

from core.plugin.entities.plugin_daemon import CredentialType, PluginTriggerProviderEntity
from core.plugin.entities.request import (
    TriggerDispatchResponse,
    TriggerInvokeEventResponse,
    TriggerSubscriptionResponse,
    TriggerValidateProviderCredentialsResponse,
)
from core.plugin.impl.base import BasePluginClient
from core.plugin.utils.http_parser import serialize_request
from core.trigger.entities.entities import Subscription
from models.provider_ids import TriggerProviderID


class PluginTriggerClient(BasePluginClient):
    def fetch_trigger_providers(self, tenant_id: str) -> list[PluginTriggerProviderEntity]:
        """
        Fetch trigger providers for the given tenant.
        """

        def transformer(json_response: dict[str, Any]) -> dict[str, Any]:
            for provider in json_response.get("data", []):
                declaration = provider.get("declaration", {}) or {}
                provider_id = provider.get("plugin_id") + "/" + provider.get("provider")
                for event in declaration.get("events", []):
                    event["identity"]["provider"] = provider_id

            return json_response

        response: list[PluginTriggerProviderEntity] = self._request_with_plugin_daemon_response(
            method="GET",
            path=f"plugin/{tenant_id}/management/triggers",
            type_=list[PluginTriggerProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )

        for provider in response:
            provider.declaration.identity.name = f"{provider.plugin_id}/{provider.declaration.identity.name}"

            # override the provider name for each trigger to plugin_id/provider_name
            for event in provider.declaration.events:
                event.identity.provider = provider.declaration.identity.name

        return response

    def fetch_trigger_provider(self, tenant_id: str, provider_id: TriggerProviderID) -> PluginTriggerProviderEntity:
        """
        Fetch trigger provider for the given tenant and plugin.
        """

        def transformer(json_response: dict[str, Any]) -> dict[str, Any]:
            data = json_response.get("data")
            if data:
                for event in data.get("declaration", {}).get("events", []):
                    event["identity"]["provider"] = str(provider_id)

            return json_response

        response: PluginTriggerProviderEntity = self._request_with_plugin_daemon_response(
            method="GET",
            path=f"plugin/{tenant_id}/management/trigger",
            type_=PluginTriggerProviderEntity,
            params={"provider": provider_id.provider_name, "plugin_id": provider_id.plugin_id},
            transformer=transformer,
        )

        response.declaration.identity.name = str(provider_id)

        # override the provider name for each trigger to plugin_id/provider_name
        for event in response.declaration.events:
            event.identity.provider = str(provider_id)

        return response

    def invoke_trigger_event(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        event_name: str,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
        request: Request,
        parameters: Mapping[str, Any],
        subscription: Subscription,
        payload: Mapping[str, Any],
    ) -> TriggerInvokeEventResponse:
        """
        Invoke a trigger with the given parameters.
        """
        provider_id = TriggerProviderID(provider)
        response: Generator[TriggerInvokeEventResponse, None, None] = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/trigger/invoke_event",
            type_=TriggerInvokeEventResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider_id.provider_name,
                    "event": event_name,
                    "credentials": credentials,
                    "credential_type": credential_type,
                    "subscription": subscription.model_dump(),
                    "raw_http_request": binascii.hexlify(serialize_request(request)).decode(),
                    "parameters": parameters,
                    "payload": payload,
                },
            },
            headers={
                "X-Plugin-ID": provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp

        raise ValueError("No response received from plugin daemon for invoke trigger")

    def validate_provider_credentials(
        self, tenant_id: str, user_id: str, provider: str, credentials: Mapping[str, str]
    ) -> bool:
        """
        Validate the credentials of the trigger provider.
        """
        provider_id = TriggerProviderID(provider)
        response: Generator[TriggerValidateProviderCredentialsResponse, None, None] = (
            self._request_with_plugin_daemon_response_stream(
                method="POST",
                path=f"plugin/{tenant_id}/dispatch/trigger/validate_credentials",
                type_=TriggerValidateProviderCredentialsResponse,
                data={
                    "user_id": user_id,
                    "data": {
                        "provider": provider_id.provider_name,
                        "credentials": credentials,
                    },
                },
                headers={
                    "X-Plugin-ID": provider_id.plugin_id,
                    "Content-Type": "application/json",
                },
            )
        )

        for resp in response:
            return resp.result

        raise ValueError("No response received from plugin daemon for validate provider credentials")

    def dispatch_event(
        self,
        tenant_id: str,
        provider: str,
        subscription: Mapping[str, Any],
        request: Request,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> TriggerDispatchResponse:
        """
        Dispatch an event to triggers.
        """
        provider_id = TriggerProviderID(provider)
        response = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/trigger/dispatch_event",
            type_=TriggerDispatchResponse,
            data={
                "data": {
                    "provider": provider_id.provider_name,
                    "subscription": subscription,
                    "credentials": credentials,
                    "credential_type": credential_type,
                    "raw_http_request": binascii.hexlify(serialize_request(request)).decode(),
                },
            },
            headers={
                "X-Plugin-ID": provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp

        raise ValueError("No response received from plugin daemon for dispatch event")

    def subscribe(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
        endpoint: str,
        parameters: Mapping[str, Any],
    ) -> TriggerSubscriptionResponse:
        """
        Subscribe to a trigger.
        """
        provider_id = TriggerProviderID(provider)
        response: Generator[TriggerSubscriptionResponse, None, None] = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/trigger/subscribe",
            type_=TriggerSubscriptionResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider_id.provider_name,
                    "credentials": credentials,
                    "credential_type": credential_type,
                    "endpoint": endpoint,
                    "parameters": parameters,
                },
            },
            headers={
                "X-Plugin-ID": provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp

        raise ValueError("No response received from plugin daemon for subscribe")

    def unsubscribe(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        subscription: Subscription,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> TriggerSubscriptionResponse:
        """
        Unsubscribe from a trigger.
        """
        provider_id = TriggerProviderID(provider)
        response: Generator[TriggerSubscriptionResponse, None, None] = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/trigger/unsubscribe",
            type_=TriggerSubscriptionResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider_id.provider_name,
                    "subscription": subscription.model_dump(),
                    "credentials": credentials,
                    "credential_type": credential_type,
                },
            },
            headers={
                "X-Plugin-ID": provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp

        raise ValueError("No response received from plugin daemon for unsubscribe")

    def refresh(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        subscription: Subscription,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
    ) -> TriggerSubscriptionResponse:
        """
        Refresh a trigger subscription.
        """
        provider_id = TriggerProviderID(provider)
        response: Generator[TriggerSubscriptionResponse, None, None] = self._request_with_plugin_daemon_response_stream(
            method="POST",
            path=f"plugin/{tenant_id}/dispatch/trigger/refresh",
            type_=TriggerSubscriptionResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": provider_id.provider_name,
                    "subscription": subscription.model_dump(),
                    "credentials": credentials,
                    "credential_type": credential_type,
                },
            },
            headers={
                "X-Plugin-ID": provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp

        raise ValueError("No response received from plugin daemon for refresh")
