"""
Sandbox Provider Service for managing sandbox configurations.

Supports three provider types:
- e2b: Cloud-based sandbox (requires API key)
- docker: Local Docker-based sandbox (self-hosted)
- local: Local execution without isolation (self-hosted only)
"""

import json
import logging
from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from configs import dify_config
from constants import HIDDEN_VALUE
from core.entities.provider_entities import BasicProviderConfig
from core.tools.utils.system_encryption import (
    decrypt_system_params,
)
from core.virtual_environment.__base.virtual_environment import VirtualEnvironment
from core.virtual_environment.factory import VMFactory, VMType
from extensions.ext_database import db
from models.sandbox import SandboxProvider, SandboxProviderSystemConfig
from services.sandbox.encryption import create_sandbox_config_encrypter, masked_config

logger = logging.getLogger(__name__)


class SandboxProviderType(StrEnum):
    E2B = "e2b"
    DOCKER = "docker"
    LOCAL = "local"


class E2BConfig(BaseModel):
    api_key: str = ""
    e2b_api_url: str = "https://api.e2b.app"
    e2b_default_template: str = "code-interpreter-v1"

    @model_validator(mode="before")
    @classmethod
    def check_required(cls, values: dict[str, Any]) -> dict[str, Any]:
        if not values.get("api_key"):
            raise ValueError("api_key is required")
        return values


class DockerConfig(BaseModel):
    docker_sock: str = "unix:///var/run/docker.sock"
    docker_image: str = "ubuntu:latest"


class LocalConfig(BaseModel):
    pass


PROVIDER_CONFIG_MODELS: dict[str, type[BaseModel]] = {
    SandboxProviderType.E2B: E2BConfig,
    SandboxProviderType.DOCKER: DockerConfig,
    SandboxProviderType.LOCAL: LocalConfig,
}

PROVIDER_CONFIG_SCHEMAS: dict[str, list[BasicProviderConfig]] = {
    SandboxProviderType.E2B: [
        BasicProviderConfig(type=BasicProviderConfig.Type.SECRET_INPUT, name="api_key"),
        BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name="e2b_api_url"),
        BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name="e2b_default_template"),
    ],
    SandboxProviderType.DOCKER: [
        BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name="docker_sock"),
        BasicProviderConfig(type=BasicProviderConfig.Type.TEXT_INPUT, name="docker_image"),
    ],
    SandboxProviderType.LOCAL: [],
}


class SandboxProviderInfo(BaseModel):
    provider_type: str = Field(..., description="Provider type identifier")
    label: str = Field(..., description="Display name")
    description: str = Field(..., description="Provider description")
    icon: str = Field(..., description="Icon identifier")
    is_system_configured: bool = Field(default=False, description="Whether system default is configured")
    is_tenant_configured: bool = Field(default=False, description="Whether tenant has custom config")
    is_active: bool = Field(default=False, description="Whether this provider is active for the tenant")
    config: Mapping[str, Any] = Field(default_factory=dict, description="Masked config")
    config_schema: list[dict[str, Any]] = Field(default_factory=list, description="Config form schema")


PROVIDER_METADATA: dict[str, dict[str, str]] = {
    SandboxProviderType.E2B: {
        "label": "E2B",
        "description": "Cloud-based sandbox powered by E2B. Secure, scalable, and managed.",
        "icon": "e2b",
    },
    SandboxProviderType.DOCKER: {
        "label": "Docker",
        "description": "Local Docker-based sandbox. Requires Docker daemon running on the host.",
        "icon": "docker",
    },
    SandboxProviderType.LOCAL: {
        "label": "Local",
        "description": "Local execution without isolation. Only for development/testing.",
        "icon": "local",
    },
}


class SandboxProviderService:
    @classmethod
    def get_available_provider_types(cls) -> list[str]:
        providers = [SandboxProviderType.E2B, SandboxProviderType.DOCKER]
        if dify_config.EDITION == "SELF_HOSTED":
            providers.append(SandboxProviderType.LOCAL)
        return [provider.value for provider in providers]

    @classmethod
    def list_providers(cls, tenant_id: str) -> list[SandboxProviderInfo]:
        result: list[SandboxProviderInfo] = []

        with Session(db.engine, expire_on_commit=False) as session:
            tenant_configs = {
                cfg.provider_type: cfg
                for cfg in session.query(SandboxProvider).filter(SandboxProvider.tenant_id == tenant_id).all()
            }
            system_defaults = {cfg.provider_type for cfg in session.query(SandboxProviderSystemConfig).all()}

            for provider_type in cls.get_available_provider_types():
                tenant_config = tenant_configs.get(provider_type)
                schema = PROVIDER_CONFIG_SCHEMAS.get(provider_type, [])
                metadata = PROVIDER_METADATA.get(provider_type, {})

                config: Mapping[str, Any] = {}
                if tenant_config and tenant_config.config:
                    encrypter, _ = create_sandbox_config_encrypter(tenant_id, schema, provider_type)
                    config = masked_config(schema, encrypter.decrypt(tenant_config.config))

                result.append(
                    SandboxProviderInfo(
                        provider_type=provider_type,
                        label=metadata.get("label", provider_type),
                        description=metadata.get("description", ""),
                        icon=metadata.get("icon", provider_type),
                        is_system_configured=provider_type in system_defaults and tenant_config is None,
                        is_tenant_configured=tenant_config is not None,
                        is_active=tenant_config.is_active if tenant_config else False,
                        config=config,
                        config_schema=[{"name": c.name, "type": c.type.value} for c in schema],
                    )
                )

        return result

    @classmethod
    def get_provider(cls, tenant_id: str, provider_type: str) -> SandboxProviderInfo | None:
        if provider_type not in cls.get_available_provider_types():
            return None

        providers = cls.list_providers(tenant_id)
        for provider in providers:
            if provider.provider_type == provider_type:
                return provider
        return None

    @classmethod
    def validate_config(cls, provider_type: str, config: Mapping[str, Any]) -> None:
        model_class = PROVIDER_CONFIG_MODELS.get(provider_type)
        if model_class:
            model_class.model_validate(config)

        VMFactory.validate(VMType(provider_type), config)

    @classmethod
    def save_config(
        cls,
        tenant_id: str,
        provider_type: str,
        config: Mapping[str, Any],
    ) -> dict[str, Any]:
        if provider_type not in cls.get_available_provider_types():
            raise ValueError(f"Invalid provider type: {provider_type}")

        with Session(db.engine) as session:
            existing = (
                session.query(SandboxProvider)
                .filter(
                    SandboxProvider.tenant_id == tenant_id,
                    SandboxProvider.provider_type == provider_type,
                )
                .first()
            )

            schema = PROVIDER_CONFIG_SCHEMAS.get(provider_type, [])
            encrypter, _ = create_sandbox_config_encrypter(tenant_id, schema, provider_type)

            final_config = dict(config)
            if existing and existing.config:
                existing_config = encrypter.decrypt(existing.config)
                for key, value in final_config.items():
                    if value == HIDDEN_VALUE:
                        final_config[key] = existing_config.get(key, "")

            cls.validate_config(provider_type, final_config)

            encrypted = encrypter.encrypt(final_config)

            if existing:
                existing.encrypted_config = json.dumps(encrypted)
            else:
                new_config = SandboxProvider(
                    tenant_id=tenant_id,
                    provider_type=provider_type,
                    encrypted_config=json.dumps(encrypted),
                    is_active=False,
                )
                session.add(new_config)

            session.commit()

        return {"result": "success"}

    @classmethod
    def delete_config(cls, tenant_id: str, provider_type: str) -> dict[str, Any]:
        with Session(db.engine) as session:
            config = (
                session.query(SandboxProvider)
                .filter(
                    SandboxProvider.tenant_id == tenant_id,
                    SandboxProvider.provider_type == provider_type,
                )
                .first()
            )

            if not config:
                return {"result": "success"}

            session.delete(config)
            session.commit()

        return {"result": "success"}

    @classmethod
    def activate_provider(cls, tenant_id: str, provider_type: str) -> dict[str, Any]:
        if provider_type not in cls.get_available_provider_types():
            raise ValueError(f"Invalid provider type: {provider_type}")

        with Session(db.engine) as session:
            tenant_config = (
                session.query(SandboxProvider)
                .filter(
                    SandboxProvider.tenant_id == tenant_id,
                    SandboxProvider.provider_type == provider_type,
                )
                .first()
            )

            system_default = (
                session.query(SandboxProviderSystemConfig)
                .filter(SandboxProviderSystemConfig.provider_type == provider_type)
                .first()
            )

            config_schema = PROVIDER_CONFIG_SCHEMAS.get(provider_type, [])
            needs_config = len(config_schema) > 0

            if needs_config and not tenant_config and not system_default:
                raise ValueError(f"Provider {provider_type} is not configured. Please add configuration first.")

            session.query(SandboxProvider).filter(
                SandboxProvider.tenant_id == tenant_id,
            ).update({"is_active": False})

            if tenant_config:
                tenant_config.is_active = True
            else:
                new_config = SandboxProvider(
                    tenant_id=tenant_id,
                    provider_type=provider_type,
                    encrypted_config=json.dumps({}),
                    is_active=True,
                )
                session.add(new_config)

            session.commit()

        return {"result": "success"}

    @classmethod
    def get_active_provider(cls, tenant_id: str) -> str | None:
        with Session(db.engine, expire_on_commit=False) as session:
            config = (
                session.query(SandboxProvider)
                .filter(
                    SandboxProvider.tenant_id == tenant_id,
                    SandboxProvider.is_active.is_(True),
                )
                .first()
            )
            return config.provider_type if config else None

    @classmethod
    def create_sandbox(
        cls,
        tenant_id: str,
        environments: Mapping[str, str] | None = None,
    ) -> VirtualEnvironment:
        with Session(db.engine, expire_on_commit=False) as session:
            # Get config: tenant config > system default > raise error
            tenant_config = (
                session.query(SandboxProvider)
                .filter(
                    SandboxProvider.tenant_id == tenant_id,
                    SandboxProvider.is_active.is_(True),
                )
                .first()
            )
            config: Mapping[str, Any] = {}
            provider_type = None
            if tenant_config:
                schema = PROVIDER_CONFIG_SCHEMAS.get(tenant_config.provider_type, [])
                encrypter, _ = create_sandbox_config_encrypter(tenant_id, schema, tenant_config.provider_type)
                config = encrypter.decrypt(tenant_config.config)
                provider_type = tenant_config.provider_type
            else:
                system_default = session.query(SandboxProviderSystemConfig).first()
                if system_default:
                    config = decrypt_system_params(system_default.encrypted_config)
                    provider_type = system_default.provider_type

            if not config or not provider_type:
                raise ValueError(f"No active sandbox provider for tenant {tenant_id} or system default")

            return VMFactory.create(
                tenant_id=tenant_id,
                vm_type=VMType(provider_type),
                options=dict(config),
                environments=environments or {},
            )
