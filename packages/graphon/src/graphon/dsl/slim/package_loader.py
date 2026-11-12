from __future__ import annotations

import io
import shutil
import zipfile
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
import yaml

from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
    ParameterType,
    PriceConfig,
)
from graphon.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FieldModelSchema,
    FormOption,
    FormShowOnObject,
    FormType,
    ModelCredentialSchema,
    ProviderCredentialSchema,
    ProviderEntity,
    ProviderHelpEntity,
)

from .config import SlimConfig, SlimProviderBinding

_MODEL_GLOB_KEYS: tuple[str, ...] = (
    "llm",
    "text_embedding",
    "rerank",
    "tts",
    "speech2text",
    "moderation",
)


@dataclass(slots=True, frozen=True)
class LoadedSlimProvider:
    binding: SlimProviderBinding
    plugin_root: Path
    provider_entity: ProviderEntity
    asset_root: Path


class SlimPackageLoader:
    def __init__(self, config: SlimConfig) -> None:
        self._config = config

    def convert_model_entity(
        self,
        raw_model: dict[str, Any],
    ) -> AIModelEntity | None:
        """Convert a raw provider-declared model into a validated entity."""
        return self._convert_model_entity(raw_model)

    def load(self, binding: SlimProviderBinding) -> LoadedSlimProvider:
        plugin_root = (
            binding.plugin_root
            if binding.plugin_root is not None
            else self._ensure_plugin_root(binding.plugin_id)
        )
        provider_declaration = self._load_provider_declaration(
            plugin_root=plugin_root,
            provider=binding.provider,
        )
        provider_entity = self._build_provider_entity(
            provider_declaration=provider_declaration,
        )
        if binding.provider and provider_entity.provider != binding.provider:
            msg = (
                "Slim binding provider mismatch: "
                f"expected {binding.provider}, got {provider_entity.provider}"
            )
            raise ValueError(msg)
        return LoadedSlimProvider(
            binding=binding,
            plugin_root=plugin_root,
            provider_entity=provider_entity,
            asset_root=plugin_root / "_assets",
        )

    def _ensure_plugin_root(self, plugin_id: str) -> Path:
        plugin_root = self._config.local.folder / plugin_id.replace(":", "-")
        if plugin_root.exists():
            return plugin_root

        plugin_root.parent.mkdir(parents=True, exist_ok=True)
        self._download_and_extract_plugin(plugin_id=plugin_id, plugin_root=plugin_root)
        return plugin_root

    def _download_and_extract_plugin(
        self,
        *,
        plugin_id: str,
        plugin_root: Path,
    ) -> None:
        marketplace_url = self._config.local.marketplace_url
        query = urlencode({"unique_identifier": plugin_id})
        url = f"{marketplace_url.rstrip('/')}/api/v1/plugins/download?{query}"
        timeout = httpx.Timeout(self._config.download_timeout_seconds)
        response = httpx.get(url, timeout=timeout, follow_redirects=True)
        response.raise_for_status()
        if len(response.content) > self._config.marketplace_download_limit_bytes:
            msg = (
                f"Plugin package {plugin_id} exceeds "
                f"{self._config.marketplace_download_limit_bytes} bytes."
            )
            raise ValueError(msg)

        if plugin_root.exists():
            shutil.rmtree(plugin_root)
        plugin_root.mkdir(parents=True, exist_ok=True)

        try:
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                self._safe_extract_zip(archive, plugin_root)
        except Exception:
            shutil.rmtree(plugin_root, ignore_errors=True)
            raise

    @staticmethod
    def _safe_extract_zip(archive: zipfile.ZipFile, target_dir: Path) -> None:
        target_dir = target_dir.resolve()
        for member in archive.infolist():
            destination = target_dir / member.filename
            resolved_destination = destination.resolve()
            if (
                target_dir not in resolved_destination.parents
                and resolved_destination != target_dir
            ):
                msg = f"Unsafe zip entry {member.filename!r} would escape {target_dir}"
                raise ValueError(msg)
        archive.extractall(target_dir)

    def _load_provider_declaration(
        self,
        *,
        plugin_root: Path,
        provider: str,
    ) -> dict[str, Any]:
        manifest = self._load_yaml(plugin_root / "manifest.yaml")
        model_provider_paths = manifest.get("plugins", {}).get("models", [])
        if not model_provider_paths:
            msg = f"No model provider declarations found in {plugin_root}"
            raise ValueError(msg)

        if not provider and len(model_provider_paths) > 1:
            msg = (
                "Slim binding provider is required when a plugin declares "
                "multiple model providers."
            )
            raise ValueError(msg)

        provider_declaration: dict[str, Any] | None = None
        for provider_path in model_provider_paths:
            declaration = self._load_yaml(plugin_root / provider_path)
            if not provider or declaration.get("provider") == provider:
                provider_declaration = declaration
                break

        if provider_declaration is None:
            msg = f"Provider {provider!r} not found in {plugin_root}"
            raise ValueError(msg)

        models_section = provider_declaration.get("models", {}) or {}
        provider_declaration["models"] = self._load_model_declarations(
            plugin_root=plugin_root,
            models_section=models_section,
        )
        provider_declaration["position"] = self._load_position_map(
            plugin_root=plugin_root,
            models_section=models_section,
        )
        return provider_declaration

    def _load_model_declarations(
        self,
        *,
        plugin_root: Path,
        models_section: dict[str, Any],
    ) -> list[dict[str, Any]]:
        model_files: list[Path] = []
        for key in _MODEL_GLOB_KEYS:
            config = models_section.get(key, {}) or {}
            for pattern in config.get("predefined", []) or []:
                for file_path in sorted(plugin_root.glob(pattern)):
                    if file_path.name.endswith("_position.yaml"):
                        continue
                    model_files.append(file_path)

        declarations: list[dict[str, Any]] = []
        seen_files: set[Path] = set()
        for model_file in model_files:
            if model_file in seen_files:
                continue
            declarations.append(self._load_yaml(model_file))
            seen_files.add(model_file)
        return declarations

    def _load_position_map(
        self,
        *,
        plugin_root: Path,
        models_section: dict[str, Any],
    ) -> dict[str, list[str]] | None:
        position_map: dict[str, list[str]] = {}
        for key in _MODEL_GLOB_KEYS:
            config = models_section.get(key, {}) or {}
            position_file = config.get("position")
            if not position_file:
                continue
            position_map[key] = self._load_yaml(plugin_root / position_file)
        return position_map or None

    @staticmethod
    def _load_yaml(path: Path) -> Any:
        with path.open("r", encoding="utf-8") as file:
            return yaml.safe_load(file) or {}

    def _build_provider_entity(
        self,
        *,
        provider_declaration: dict[str, Any],
    ) -> ProviderEntity:
        supported_model_types = [
            model_type
            for item in provider_declaration.get("supported_model_types", []) or []
            if (model_type := self._convert_model_type(item)) is not None
        ]
        configurate_methods = [
            method
            for item in provider_declaration.get("configurate_methods", []) or []
            if (method := self._convert_configurate_method(item)) is not None
        ]

        return ProviderEntity(
            provider=str(provider_declaration["provider"]),
            provider_name=str(provider_declaration.get("provider") or ""),
            label=self._convert_i18n(provider_declaration.get("label")),
            description=self._convert_optional_i18n(
                provider_declaration.get("description"),
            ),
            icon_small=self._convert_optional_i18n(
                provider_declaration.get("icon_small"),
            ),
            icon_small_dark=self._convert_optional_i18n(
                provider_declaration.get("icon_small_dark"),
            ),
            background=provider_declaration.get("background"),
            help=self._convert_provider_help(provider_declaration.get("help")),
            supported_model_types=supported_model_types,
            configurate_methods=configurate_methods,
            models=[
                model_entity
                for raw_model in provider_declaration.get("models", []) or []
                if (model_entity := self._convert_model_entity(raw_model)) is not None
            ],
            provider_credential_schema=self._convert_provider_credential_schema(
                provider_declaration.get("provider_credential_schema"),
            ),
            model_credential_schema=self._convert_model_credential_schema(
                provider_declaration.get("model_credential_schema"),
            ),
            position=provider_declaration.get("position") or {},
        )

    def _convert_model_entity(self, raw_model: dict[str, Any]) -> AIModelEntity | None:
        model_type = self._convert_model_type(raw_model.get("model_type"))
        fetch_from = self._convert_fetch_from(raw_model.get("fetch_from"))
        if model_type is None or fetch_from is None:
            return None

        raw_features = raw_model.get("features")
        features = [
            feature
            for item in raw_features or []
            if (feature := self._convert_model_feature(item)) is not None
        ]
        model_properties = {
            key: value
            for raw_key, value in (raw_model.get("model_properties") or {}).items()
            if (key := self._convert_model_property_key(raw_key)) is not None
        }

        return AIModelEntity(
            model=str(raw_model["model"]),
            label=self._convert_i18n(raw_model.get("label")),
            model_type=model_type,
            features=features if raw_features is not None else None,
            fetch_from=fetch_from,
            model_properties=model_properties,
            deprecated=bool(raw_model.get("deprecated")),
            parameter_rules=[
                parameter_rule
                for raw_rule in raw_model.get("parameter_rules", []) or []
                if (parameter_rule := self._convert_parameter_rule(raw_rule))
                is not None
            ],
            pricing=self._convert_pricing(raw_model.get("pricing")),
        )

    @staticmethod
    def _convert_i18n(value: dict[str, Any] | None) -> I18nObject:
        if value is None:
            msg = "Missing required i18n object."
            raise ValueError(msg)
        en_us = value.get("en_US") or value.get("en-us") or value.get("en")
        zh_hans = value.get("zh_Hans") or value.get("zh-hans") or value.get("zh_CN")
        if not en_us:
            msg = f"Missing en_US translation in {value}"
            raise ValueError(msg)
        return I18nObject.model_validate({
            "en_US": str(en_us),
            "zh_Hans": str(zh_hans or en_us),
        })

    def _convert_optional_i18n(self, value: dict[str, Any] | None) -> I18nObject | None:
        if value is None:
            return None
        return self._convert_i18n(value)

    def _convert_provider_help(
        self,
        value: dict[str, Any] | None,
    ) -> ProviderHelpEntity | None:
        if value is None:
            return None
        return ProviderHelpEntity(
            title=self._convert_i18n(value.get("title")),
            url=self._convert_i18n(value.get("url")),
        )

    def _convert_provider_credential_schema(
        self,
        value: dict[str, Any] | None,
    ) -> ProviderCredentialSchema | None:
        if value is None:
            return None
        return ProviderCredentialSchema(
            credential_form_schemas=[
                schema
                for item in value.get("credential_form_schemas", []) or []
                if (schema := self._convert_credential_form_schema(item)) is not None
            ],
        )

    def _convert_model_credential_schema(
        self,
        value: dict[str, Any] | None,
    ) -> ModelCredentialSchema | None:
        if value is None:
            return None
        return ModelCredentialSchema(
            model=FieldModelSchema(
                label=self._convert_i18n(value.get("model", {}).get("label")),
                placeholder=self._convert_optional_i18n(
                    value.get("model", {}).get("placeholder"),
                ),
            ),
            credential_form_schemas=[
                schema
                for item in value.get("credential_form_schemas", []) or []
                if (schema := self._convert_credential_form_schema(item)) is not None
            ],
        )

    def _convert_credential_form_schema(
        self,
        value: dict[str, Any] | None,
    ) -> CredentialFormSchema | None:
        if value is None:
            return None
        form_type = self._convert_form_type(value.get("type"))
        if form_type is None:
            return None
        return CredentialFormSchema(
            variable=str(value["variable"]),
            label=self._convert_i18n(value.get("label")),
            type=form_type,
            required=bool(value.get("required", True)),
            default=value.get("default"),
            options=[
                FormOption(
                    label=self._convert_i18n(option.get("label")),
                    value=str(option["value"]),
                    show_on=[
                        self._convert_show_on(show_on)
                        for show_on in option.get("show_on", []) or []
                    ],
                )
                for option in value.get("options", []) or []
            ]
            or None,
            placeholder=self._convert_optional_i18n(value.get("placeholder")),
            max_length=int(value.get("max_length", 0)),
            show_on=[
                self._convert_show_on(show_on)
                for show_on in value.get("show_on", []) or []
            ],
        )

    @staticmethod
    def _convert_show_on(value: dict[str, Any]) -> FormShowOnObject:
        return FormShowOnObject(
            variable=str(value["variable"]),
            value=str(value["value"]),
        )

    def _convert_parameter_rule(
        self,
        value: dict[str, Any] | None,
    ) -> ParameterRule | None:
        if value is None:
            return None
        parameter_type = self._convert_parameter_type(value.get("type"))
        if parameter_type is None and not value.get("use_template"):
            return None
        return ParameterRule(
            name=str(value["name"]),
            use_template=value.get("use_template"),
            label=self._convert_i18n(value.get("label") or {"en_US": value["name"]}),
            type=parameter_type or ParameterType.STRING,
            help=self._convert_optional_i18n(value.get("help")),
            required=bool(value.get("required", False)),
            default=value.get("default"),
            min=value.get("min"),
            max=value.get("max"),
            precision=value.get("precision"),
            options=[str(option) for option in value.get("options", []) or []],
        )

    @staticmethod
    def _convert_pricing(value: dict[str, Any] | None) -> PriceConfig | None:
        if value is None:
            return None
        output = value.get("output")
        return PriceConfig(
            input=Decimal(str(value["input"])),
            output=Decimal(str(output)) if output is not None else None,
            unit=Decimal(str(value["unit"])),
            currency=str(value["currency"]),
        )

    @staticmethod
    def _convert_form_type(value: str | None) -> FormType | None:
        if value is None:
            return None
        normalized = str(value).replace("_", "-").lower()
        mapping = {
            "text-input": FormType.TEXT_INPUT,
            "secret-input": FormType.SECRET_INPUT,
            "select": FormType.SELECT,
            "radio": FormType.RADIO,
            "switch": FormType.SWITCH,
        }
        return mapping.get(normalized)

    @staticmethod
    def _convert_parameter_type(value: str | None) -> ParameterType | None:
        if value is None:
            return None
        try:
            return ParameterType(str(value))
        except ValueError:
            return None

    @staticmethod
    def _convert_configurate_method(
        value: str | None,
    ) -> ConfigurateMethod | None:
        if value is None:
            return None
        try:
            return ConfigurateMethod(str(value))
        except ValueError:
            return None

    @staticmethod
    def _convert_fetch_from(value: str | None) -> FetchFrom | None:
        if value is None:
            return None
        try:
            return FetchFrom(str(value))
        except ValueError:
            return None

    @staticmethod
    def _convert_model_feature(value: str | None) -> ModelFeature | None:
        if value is None:
            return None
        try:
            return ModelFeature(str(value))
        except ValueError:
            return None

    @staticmethod
    def _convert_model_property_key(
        value: str | None,
    ) -> ModelPropertyKey | None:
        if value is None:
            return None
        try:
            return ModelPropertyKey(str(value))
        except ValueError:
            return None

    @staticmethod
    def _convert_model_type(value: str | None) -> ModelType | None:
        if value is None:
            return None
        try:
            return ModelType(str(value))
        except ValueError:
            return None
