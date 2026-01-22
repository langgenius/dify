import json
import logging
from collections.abc import Mapping
from typing import Any

from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from core.sandbox import (
    SandboxBuilder,
    SandboxProviderApiEntity,
    SandboxType,
    VMConfig,
    create_sandbox_config_encrypter,
    masked_config,
)
from core.sandbox.entities.providers import SandboxProviderEntity
from core.tools.utils.system_encryption import decrypt_system_params
from extensions.ext_database import db
from models.sandbox import SandboxProvider, SandboxProviderSystemConfig

logger = logging.getLogger(__name__)


def _get_encrypter(tenant_id: str, provider_type: str):
    return create_sandbox_config_encrypter(tenant_id, VMConfig.get_schema(SandboxType(provider_type)), provider_type)[0]


def _query_tenant_config(session: Session, tenant_id: str, provider_type: str) -> SandboxProvider | None:
    return (
        session.query(SandboxProvider)
        .filter(SandboxProvider.tenant_id == tenant_id, SandboxProvider.provider_type == provider_type)
        .first()
    )


class SandboxProviderService:
    @classmethod
    def list_providers(cls, tenant_id: str) -> list[SandboxProviderApiEntity]:
        with Session(db.engine, expire_on_commit=False) as session:
            provider_types = SandboxType.get_all()
            tenant_configs = {
                config.provider_type: config
                for config in session.query(SandboxProvider).filter(SandboxProvider.tenant_id == tenant_id).all()
            }
            system_configs = {
                config.provider_type: config
                for config in session.query(SandboxProviderSystemConfig)
                .filter(SandboxProviderSystemConfig.provider_type.in_(provider_types))
                .all()
            }

            providers: list[SandboxProviderApiEntity] = []
            current_provider = cls.get_active_sandbox_config(session, tenant_id)
            for provider_type in SandboxType.get_all():
                tenant_config = tenant_configs.get(provider_type)
                schema = VMConfig.get_schema(SandboxType(provider_type))
                if tenant_config:
                    is_tenant_configured = tenant_config.configure_type == "user"
                    if is_tenant_configured:
                        decrypted_config = _get_encrypter(tenant_id, provider_type).decrypt(data=tenant_config.config)
                        config = masked_config(schemas=schema, config=decrypted_config)
                    else:
                        config = {}
                    providers.append(
                        SandboxProviderApiEntity(
                            provider_type=provider_type,
                            is_system_configured=system_configs.get(provider_type) is not None,
                            is_tenant_configured=is_tenant_configured,
                            is_active=current_provider.id == tenant_config.id,
                            config=config,
                            config_schema=[c.model_dump() for c in schema],
                        )
                    )
                else:
                    system_config = system_configs.get(provider_type)
                    providers.append(
                        SandboxProviderApiEntity(
                            provider_type=provider_type,
                            is_active=system_config is not None and system_config.id == current_provider.id,
                            is_system_configured=system_config is not None,
                            config_schema=[c.model_dump() for c in schema],
                        )
                    )
            return providers

    @classmethod
    def validate_config(cls, provider_type: str, config: Mapping[str, Any]) -> None:
        SandboxBuilder.validate(SandboxType(provider_type), config)

    @classmethod
    def save_config(
        cls, tenant_id: str, provider_type: str, config: Mapping[str, Any], activate: bool
    ) -> dict[str, Any]:
        if provider_type not in SandboxType.get_all():
            raise ValueError(f"Invalid provider type: {provider_type}")

        with Session(db.engine) as session:
            provider = _query_tenant_config(session, tenant_id, provider_type)
            encrypter, cache = create_sandbox_config_encrypter(
                tenant_id, VMConfig.get_schema(SandboxType(provider_type)), provider_type
            )
            if not provider:
                provider = SandboxProvider(
                    tenant_id=tenant_id,
                    provider_type=provider_type,
                    encrypted_config=json.dumps({}),
                )
                session.add(provider)

            new_config = dict(config)
            old_config = encrypter.decrypt(provider.config)
            for key, value in new_config.items():
                if value == HIDDEN_VALUE:
                    new_config[key] = old_config.get(key, "")

            cls.validate_config(provider_type, new_config)

            provider.encrypted_config = json.dumps(encrypter.encrypt(new_config))
            provider.is_active = activate or provider.is_active or cls.is_system_default_config(session, tenant_id)
            provider.configure_type = "user"
            session.commit()

            cache.delete()
        return {"result": "success"}

    @classmethod
    def delete_config(cls, tenant_id: str, provider_type: str) -> dict[str, Any]:
        with Session(db.engine) as session:
            if config := _query_tenant_config(session, tenant_id, provider_type):
                session.delete(config)
                session.commit()
        return {"result": "success"}

    @classmethod
    def is_system_default_config(cls, session: Session, tenant_id: str) -> bool:
        system_configed: SandboxProviderSystemConfig | None = session.query(SandboxProviderSystemConfig).first()
        if not system_configed:
            return False
        active_config = cls.get_active_sandbox_config(session, tenant_id)
        return active_config.id == system_configed.id

    @classmethod
    def activate_provider(cls, tenant_id: str, provider_type: str, type: str | None = None) -> dict[str, Any]:
        if provider_type not in SandboxType.get_all():
            raise ValueError(f"Invalid provider type: {provider_type}")

        with Session(db.engine) as session:
            tenant_config = _query_tenant_config(session, tenant_id, provider_type)
            system_config = session.query(SandboxProviderSystemConfig).filter_by(provider_type=provider_type).first()

            session.query(SandboxProvider).filter(SandboxProvider.tenant_id == tenant_id).update({"is_active": False})

            # using tenant config
            if tenant_config:
                tenant_config.is_active = True
                tenant_config.configure_type = type or tenant_config.configure_type
                session.commit()
                return {"result": "success"}

            # using system config
            if system_config:
                session.add(
                    SandboxProvider(
                        is_active=True,
                        tenant_id=tenant_id,
                        configure_type="system",
                        provider_type=provider_type,
                        encrypted_config=json.dumps({}),
                    )
                )
                session.commit()
                return {"result": "success"}

            raise ValueError(f"No sandbox provider configured for tenant {tenant_id} and provider type {provider_type}")

    @classmethod
    def get_active_sandbox_config(cls, session: Session, tenant_id: str) -> SandboxProviderEntity:
        tenant_configed = (
            session.query(SandboxProvider)
            .filter(SandboxProvider.tenant_id == tenant_id, SandboxProvider.is_active.is_(True))
            .first()
        )
        if tenant_configed:
            if tenant_configed.configure_type == "user":
                config = _get_encrypter(tenant_id, tenant_configed.provider_type).decrypt(tenant_configed.config)
                return SandboxProviderEntity(
                    id=tenant_configed.id, provider_type=tenant_configed.provider_type, config=config
                )
            else:
                system_configed: SandboxProviderSystemConfig | None = (
                    session.query(SandboxProviderSystemConfig)
                    .filter_by(provider_type=tenant_configed.provider_type)
                    .first()
                )
                if not system_configed:
                    raise ValueError(
                        f"No system default provider configured for tenant {tenant_id} and provider type {tenant_configed.provider_type}"
                    )
                return SandboxProviderEntity(
                    id=tenant_configed.id,
                    provider_type=system_configed.provider_type,
                    config=decrypt_system_params(system_configed.encrypted_config),
                )

        # fallback to system default config
        system_configed: SandboxProviderSystemConfig | None = session.query(SandboxProviderSystemConfig).first()
        if system_configed:
            return SandboxProviderEntity(
                id=system_configed.id,
                provider_type=system_configed.provider_type,
                config=decrypt_system_params(system_configed.encrypted_config),
            )

        raise ValueError(f"No sandbox provider configured for tenant {tenant_id}")

    @classmethod
    def get_system_default_config(cls, session: Session, tenant_id: str, provider_type: str) -> SandboxProviderEntity:
        system_configed: SandboxProviderSystemConfig | None = (
            session.query(SandboxProviderSystemConfig).filter_by(provider_type=provider_type).first()
        )
        if system_configed:
            return SandboxProviderEntity(
                id=system_configed.id,
                provider_type=system_configed.provider_type,
                config=decrypt_system_params(system_configed.encrypted_config),
            )
        raise ValueError(f"No system default provider configured for tenant {tenant_id}")

    @classmethod
    def get_sandbox_provider(cls, tenant_id: str) -> SandboxProviderEntity:
        with Session(db.engine, expire_on_commit=False) as session:
            return cls.get_active_sandbox_config(session, tenant_id)
