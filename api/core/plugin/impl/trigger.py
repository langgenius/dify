import binascii
from collections.abc import Mapping
from typing import Any

from flask import Request

from core.plugin.entities.plugin import GenericProviderID, TriggerProviderID
from core.plugin.entities.plugin_daemon import CredentialType, PluginTriggerProviderEntity
from core.plugin.entities.request import (
    PluginTriggerDispatchResponse,
    TriggerDispatchResponse,
    TriggerInvokeResponse,
    TriggerSubscriptionResponse,
    TriggerValidateProviderCredentialsResponse,
)
from core.plugin.impl.base import BasePluginClient
from core.plugin.utils.http_parser import deserialize_response, serialize_request
from core.trigger.entities.entities import Subscription


class PluginTriggerManager(BasePluginClient):
    def fetch_trigger_providers(self, tenant_id: str) -> list[PluginTriggerProviderEntity]:
        """
        Fetch trigger providers for the given tenant.
        """

        def transformer(json_response: dict[str, Any]) -> dict:
            for provider in json_response.get("data", []):
                declaration = provider.get("declaration", {}) or {}
                provider_name = declaration.get("identity", {}).get("name")
                for trigger in declaration.get("triggers", []):
                    trigger["identity"]["provider"] = provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/triggers",
            list[PluginTriggerProviderEntity],
            params={"page": 1, "page_size": 256},
            transformer=transformer,
        )

        for provider in response:
            provider.declaration.identity.name = f"{provider.plugin_id}/{provider.declaration.identity.name}"

            # override the provider name for each trigger to plugin_id/provider_name
            for trigger in provider.declaration.triggers:
                trigger.identity.provider = provider.declaration.identity.name

        return response

    def fetch_trigger_provider(self, tenant_id: str, provider_id: TriggerProviderID) -> PluginTriggerProviderEntity:
        """
        Fetch trigger provider for the given tenant and plugin.
        """

        def transformer(json_response: dict[str, Any]) -> dict:
            data = json_response.get("data")
            if data:
                for trigger in data.get("declaration", {}).get("triggers", []):
                    trigger["identity"]["provider"] = provider_id.provider_name

            return json_response

        response = self._request_with_plugin_daemon_response(
            "GET",
            f"plugin/{tenant_id}/management/trigger",
            PluginTriggerProviderEntity,
            params={"provider": provider_id.provider_name, "plugin_id": provider_id.plugin_id},
            transformer=transformer,
        )

        response.declaration.identity.name = f"{response.plugin_id}/{response.declaration.identity.name}"

        # override the provider name for each trigger to plugin_id/provider_name
        for trigger in response.declaration.triggers:
            trigger.identity.provider = response.declaration.identity.name

        return response

    def invoke_trigger(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        trigger: str,
        credentials: Mapping[str, str],
        credential_type: CredentialType,
        request: Request,
        parameters: Mapping[str, Any],
    ) -> TriggerInvokeResponse:
        """
        Invoke a trigger with the given parameters.
        """
        trigger_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/trigger/invoke",
            TriggerInvokeResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": trigger_provider_id.provider_name,
                    "trigger": trigger,
                    "credentials": credentials,
                    "credential_type": credential_type,
                    "raw_http_request": binascii.hexlify(serialize_request(request)).decode(),
                    "parameters": parameters,
                },
            },
            headers={
                "X-Plugin-ID": trigger_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return TriggerInvokeResponse(event=resp.event)

        raise ValueError("No response received from plugin daemon for invoke trigger")

    def validate_provider_credentials(
        self, tenant_id: str, user_id: str, provider: str, credentials: Mapping[str, str]
    ) -> TriggerValidateProviderCredentialsResponse:
        """
        Validate the credentials of the trigger provider.
        """
        trigger_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/trigger/validate_credentials",
            TriggerValidateProviderCredentialsResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": trigger_provider_id.provider_name,
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": trigger_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp

        return TriggerValidateProviderCredentialsResponse(valid=False, message="No response", error="No response")

    def dispatch_event(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        subscription: Mapping[str, Any],
        request: Request,
    ) -> TriggerDispatchResponse:
        """
        Dispatch an event to triggers.
        """
        trigger_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/trigger/dispatch_event",
            PluginTriggerDispatchResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": trigger_provider_id.provider_name,
                    "subscription": subscription,
                    "raw_http_request": binascii.hexlify(serialize_request(request)).decode(),
                },
            },
            headers={
                "X-Plugin-ID": trigger_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return TriggerDispatchResponse(
                triggers=resp.triggers,
                response=deserialize_response(binascii.unhexlify(resp.raw_http_response.encode())),
            )

        raise ValueError("No response received from plugin daemon for dispatch event")

    def subscribe(
        self,
        tenant_id: str,
        user_id: str,
        provider: str,
        credentials: Mapping[str, str],
        endpoint: str,
        parameters: Mapping[str, Any],
    ) -> TriggerSubscriptionResponse:
        """
        Subscribe to a trigger.
        """
        trigger_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/trigger/subscribe",
            TriggerSubscriptionResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": trigger_provider_id.provider_name,
                    "credentials": credentials,
                    "endpoint": endpoint,
                    "parameters": parameters,
                },
            },
            headers={
                "X-Plugin-ID": trigger_provider_id.plugin_id,
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
    ) -> TriggerSubscriptionResponse:
        """
        Unsubscribe from a trigger.
        """
        trigger_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/trigger/unsubscribe",
            TriggerSubscriptionResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": trigger_provider_id.provider_name,
                    "subscription": subscription.model_dump(),
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": trigger_provider_id.plugin_id,
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
    ) -> TriggerSubscriptionResponse:
        """
        Refresh a trigger subscription.
        """
        trigger_provider_id = GenericProviderID(provider)

        response = self._request_with_plugin_daemon_response_stream(
            "POST",
            f"plugin/{tenant_id}/dispatch/trigger/refresh",
            TriggerSubscriptionResponse,
            data={
                "user_id": user_id,
                "data": {
                    "provider": trigger_provider_id.provider_name,
                    "subscription": subscription.model_dump(),
                    "credentials": credentials,
                },
            },
            headers={
                "X-Plugin-ID": trigger_provider_id.plugin_id,
                "Content-Type": "application/json",
            },
        )

        for resp in response:
            return resp

        raise ValueError("No response received from plugin daemon for refresh")
