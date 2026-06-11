#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

# This module now lives at <repo>/dify/api/core/dsl_agent/plugin_resolver.py.
# parents[4] == the repo root that holds dify/ and dify-official-plugins/.
ROOT = Path(__file__).resolve().parents[4]
OFFICIAL_PLUGINS_DIR = ROOT / "dify-official-plugins"
EXTRACTED_TEMPLATES_DIR = ROOT / "dify" / "scripts" / "dsl_generator" / "templates" / "extracted"
TEMPLATES_DIR = EXTRACTED_TEMPLATES_DIR.parent


def safe_load_yaml(path: Path) -> dict[str, Any]:
    try:
        raw = yaml.safe_load(path.read_text())
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def label_text(value: Any) -> str:
    if isinstance(value, dict):
        return " ".join(str(v) for v in value.values() if v)
    return str(value or "")


def normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def token_score(query: str, text: str) -> int:
    query_tokens = [t for t in normalize_text(query).split() if len(t) > 1]
    haystack = normalize_text(text)
    return sum(1 for token in query_tokens if token in haystack)


def identity_match_score(request: str, identities: list[str]) -> int:
    request_text = normalize_text(request)
    request_tokens = set(request_text.split())
    score = 0
    for identity in identities:
        normalized = normalize_text(identity)
        if not normalized:
            continue
        identity_tokens = normalized.split()
        if not identity_tokens:
            continue
        if normalized in request_tokens:
            score += 40
        elif normalized in request_text:
            score += 18
        if identity_tokens and all(token in request_tokens for token in identity_tokens):
            score += 12
    return score


def plugin_identity_terms(candidate: PluginCandidate) -> list[str]:
    terms = [
        candidate.name,
        candidate.label,
        candidate.plugin_id,
        candidate.package_identity,
        candidate.provider_id,
        candidate.provider_name,
    ]
    if candidate.plugin_id:
        terms.extend(candidate.plugin_id.split("/"))
    if candidate.provider_id:
        terms.extend(candidate.provider_id.split("/"))
    return [term for term in terms if term]


def template_identity_terms(template: dict[str, Any]) -> list[str]:
    terms = [
        template.get("name"),
        template.get("plugin_id"),
        template.get("provider_id"),
        template.get("tool_name"),
        template.get("event_name"),
        plugin_id_from_unique_identifier(template.get("plugin_unique_identifier")),
    ]
    for key in ("plugin_id", "provider_id"):
        value = template.get(key)
        if isinstance(value, str):
            terms.extend(value.split("/"))
    return [str(term) for term in terms if term]


def template_ref(path: Path) -> str:
    try:
        return path.relative_to(TEMPLATES_DIR).as_posix()
    except ValueError:
        return str(path)


def plugin_id_from_unique_identifier(unique_identifier: str | None) -> str:
    if not unique_identifier:
        return ""
    return unique_identifier.split(":", 1)[0]


def unique_identifier_from_dependency(dependency: dict[str, Any]) -> str:
    value = dependency.get("value") or {}
    if not isinstance(value, dict):
        return ""
    return str(
        value.get("plugin_unique_identifier")
        or value.get("marketplace_plugin_unique_identifier")
        or value.get("github_plugin_unique_identifier")
        or ""
    )


def schema_field_summary(field: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": field.get("name") or field.get("variable"),
        "type": field.get("type"),
        "required": field.get("required", False),
        "label": label_text(field.get("label")),
        "help": label_text(field.get("help")),
        "url": field.get("url"),
    }


def schema_group(name: str, fields: Any) -> dict[str, Any] | None:
    if not isinstance(fields, list):
        return None
    summaries = [schema_field_summary(field) for field in fields if isinstance(field, dict)]
    summaries = [field for field in summaries if field.get("name")]
    if not summaries:
        return None
    return {"name": name, "fields": summaries}


@dataclass
class PluginCandidate:
    source: str
    kind: str
    name: str
    author: str
    version: str
    path: str
    plugin_id: str = ""
    package_identity: str = ""
    minimum_dify_version: str = ""
    label: str = ""
    description: str = ""
    provider_id: str = ""
    provider_name: str = ""
    provider_refs: list[str] = field(default_factory=list)
    tools: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    models: list[dict[str, Any]] = field(default_factory=list)
    dependencies: list[dict[str, Any]] = field(default_factory=list)
    exact_dependency_evidence: list[dict[str, Any]] = field(default_factory=list)
    credential_requirements: list[dict[str, Any]] = field(default_factory=list)
    oauth_scopes: list[str] = field(default_factory=list)
    resource: dict[str, Any] = field(default_factory=dict)
    docs: list[dict[str, str]] = field(default_factory=list)
    score: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "kind": self.kind,
            "name": self.name,
            "author": self.author,
            "version": self.version,
            "path": self.path,
            "plugin_id": self.plugin_id,
            "package_identity": self.package_identity,
            "minimum_dify_version": self.minimum_dify_version,
            "label": self.label,
            "description": self.description,
            "provider_id": self.provider_id,
            "provider_name": self.provider_name,
            "provider_refs": self.provider_refs,
            "tools": self.tools,
            "events": self.events,
            "models": self.models,
            "dependencies": self.dependencies,
            "exact_dependency_evidence": self.exact_dependency_evidence,
            "credential_requirements": self.credential_requirements,
            "oauth_scopes": self.oauth_scopes,
            "resource": self.resource,
            "docs": self.docs,
            "score": self.score,
        }


class PluginResolver:
    def __init__(
        self,
        official_plugins_dir: Path = OFFICIAL_PLUGINS_DIR,
        extracted_templates_dir: Path = EXTRACTED_TEMPLATES_DIR,
    ) -> None:
        self.official_plugins_dir = official_plugins_dir
        self.extracted_templates_dir = extracted_templates_dir
        self._official_candidates_cache: list[PluginCandidate] | None = None
        self._extracted_templates_cache: list[dict[str, Any]] | None = None

    def resolve(self, request: str, limit: int = 8) -> dict[str, Any]:
        official = self.search_official_plugins(request, limit=limit)
        official_for_linking = self.search_official_plugins(request, limit=1000)
        model_providers = self.search_model_providers(request, limit=4)
        extracted = self.search_extracted_templates(request, limit=limit)
        extracted_for_linking = self.search_extracted_templates(request, limit=1000)
        dependency_evidence = self.dependency_evidence_by_plugin_id(extracted_for_linking)
        for candidate in [*official, *official_for_linking]:
            candidate.exact_dependency_evidence = dependency_evidence.get(candidate.plugin_id, [])
        links = self.link_official_to_templates(official_for_linking, extracted_for_linking)
        top_template_refs = {item.get("template_ref") for item in extracted if item.get("template_ref")}
        linked_official_ids = {
            link.get("official_plugin_id")
            for link in links
            if link.get("template_ref") in top_template_refs and link.get("official_plugin_id")
        }
        official_by_id = {candidate.plugin_id: candidate for candidate in official}
        for candidate in official_for_linking:
            if candidate.plugin_id in linked_official_ids and candidate.plugin_id not in official_by_id:
                official.append(candidate)
                official_by_id[candidate.plugin_id] = candidate
        official = self.rank_resolved_official_candidates(request, official)
        return {
            "resolution_policy": [
                "Prefer official Dify plugins.",
                "Use extracted templates for node shape and dependency evidence when available.",
                (
                    "Only use plugin dependency hashes from exact_dependency_evidence or extracted templates; "
                    "do not fabricate hashes from manifest versions."
                ),
                "Use third-party plugins only when no official plugin covers the requirement.",
                "Use raw HTTP only when no suitable plugin exists or when explicitly requested.",
            ],
            "official_candidates": [candidate.to_dict() for candidate in official],
            "model_provider_candidates": [candidate.to_dict() for candidate in model_providers],
            "extracted_template_candidates": extracted,
            "official_template_links": links,
        }

    def rank_resolved_official_candidates(
        self,
        request: str,
        candidates: list[PluginCandidate],
    ) -> list[PluginCandidate]:
        return sorted(
            candidates,
            key=lambda item: (
                -self.resolved_official_score(request, item),
                item.kind,
                item.name,
            ),
        )

    def resolved_official_score(self, request: str, candidate: PluginCandidate) -> int:
        score = candidate.score
        identity_score = identity_match_score(request, plugin_identity_terms(candidate))
        if candidate.exact_dependency_evidence and identity_score > 0:
            score += 400
        return score

    def search_official_plugins(self, request: str, limit: int = 8) -> list[PluginCandidate]:
        candidates: list[PluginCandidate] = []
        for candidate in self.all_official_plugins():
            searchable = " ".join(
                [
                    candidate.name,
                    candidate.author,
                    candidate.label,
                    candidate.description,
                    candidate.provider_id,
                    candidate.plugin_id,
                    candidate.package_identity,
                    " ".join(group.get("name", "") for group in candidate.credential_requirements),
                    " ".join(
                        str(field.get("name", ""))
                        for group in candidate.credential_requirements
                        for field in group.get("fields", [])
                        if isinstance(field, dict)
                    ),
                    " ".join(tool.get("name", "") for tool in candidate.tools),
                    " ".join(event.get("name", "") for event in candidate.events),
                    " ".join(model.get("provider", "") for model in candidate.models),
                    " ".join(" ".join(model.get("supported_model_types", [])) for model in candidate.models),
                ]
            )
            candidate.score = token_score(request, searchable) + identity_match_score(
                request,
                plugin_identity_terms(candidate),
            )
            if candidate.author == "langgenius":
                candidate.score += 2
            if candidate.score > 0:
                candidates.append(candidate)

        return sorted(candidates, key=lambda item: (-item.score, item.kind, item.name))[:limit]

    def search_model_providers(self, request: str, limit: int = 4) -> list[PluginCandidate]:
        candidates: list[PluginCandidate] = []
        defaults = {"langgenius/openai", "langgenius/anthropic"}
        for candidate in self.all_official_plugins():
            if candidate.kind != "model":
                continue
            searchable = " ".join(
                [
                    candidate.name,
                    candidate.author,
                    candidate.label,
                    candidate.description,
                    candidate.provider_id,
                    candidate.plugin_id,
                    candidate.package_identity,
                    " ".join(model.get("provider", "") for model in candidate.models),
                    " ".join(" ".join(model.get("supported_model_types", [])) for model in candidate.models),
                    " ".join(
                        str(field.get("name", ""))
                        for group in candidate.credential_requirements
                        for field in group.get("fields", [])
                        if isinstance(field, dict)
                    ),
                ]
            )
            score = token_score(request, searchable) + identity_match_score(request, plugin_identity_terms(candidate))
            if score > 0 or candidate.plugin_id in defaults:
                candidate.score = score
                candidates.append(candidate)

        return sorted(candidates, key=lambda item: (item.plugin_id not in defaults, -item.score, item.name))[:limit]

    def all_official_plugins(self) -> list[PluginCandidate]:
        if self._official_candidates_cache is not None:
            return self._official_candidates_cache

        candidates: list[PluginCandidate] = []
        if not self.official_plugins_dir.exists():
            return candidates

        for manifest in sorted(self.official_plugins_dir.glob("*/*/manifest.yaml")):
            candidate = self._candidate_from_manifest(manifest)
            if not candidate:
                continue
            candidates.append(candidate)

        self._official_candidates_cache = candidates
        return candidates

    def _candidate_from_manifest(self, manifest_path: Path) -> PluginCandidate | None:
        manifest = safe_load_yaml(manifest_path)
        if not manifest:
            return None

        author = str(manifest.get("author") or "")
        name = str(manifest.get("name") or manifest_path.parent.name)
        version = str(manifest.get("version") or "")
        plugin_id = f"{author}/{name}" if author and name else ""
        package_identity = f"{plugin_id}:{version}" if plugin_id and version else ""
        meta = manifest.get("meta") or {}
        minimum_dify_version = str(meta.get("minimum_dify_version") or "") if isinstance(meta, dict) else ""
        kind = manifest_path.parent.parent.name.rstrip("s")
        description = label_text(manifest.get("description"))
        label = label_text(manifest.get("label"))
        resource = manifest.get("resource") if isinstance(manifest.get("resource"), dict) else {}
        provider_id = ""
        provider_name = ""
        provider_refs: list[str] = []
        tools: list[dict[str, Any]] = []
        events: list[dict[str, Any]] = []
        models: list[dict[str, Any]] = []
        credential_requirements: list[dict[str, Any]] = []
        oauth_scopes: list[str] = []

        plugins = manifest.get("plugins") or {}
        provider_refs = []
        if isinstance(plugins, dict):
            provider_refs.extend(plugins.get("tools") or [])
            provider_refs.extend(plugins.get("triggers") or [])
            provider_refs.extend(plugins.get("datasources") or [])
            provider_refs.extend(plugins.get("agent_strategies") or [])
            provider_refs.extend(plugins.get("models") or [])

        for provider_ref in provider_refs:
            provider_path = manifest_path.parent / str(provider_ref)
            provider = safe_load_yaml(provider_path)
            identity = provider.get("identity") or {}
            provider_name = str(identity.get("name") or provider.get("provider") or provider_path.stem)
            provider_author = str(identity.get("author") or author)
            provider_id = f"{provider_author}/{provider_name}/{provider_name}"
            credential_requirements.extend(self._credential_requirements(provider_path, provider))
            oauth_scopes.extend(self._oauth_scopes(provider))
            if provider.get("supported_model_types") or provider.get("models"):
                models.append(self._model_summary(provider_path, provider))

            for tool_ref in provider.get("tools") or []:
                tool_path = manifest_path.parent / str(tool_ref)
                tool = safe_load_yaml(tool_path)
                if tool:
                    tools.append(self._tool_summary(tool_path, tool))

            for event_ref in provider.get("events") or []:
                event_path = manifest_path.parent / str(event_ref)
                event = safe_load_yaml(event_path)
                if event:
                    events.append(self._event_summary(event_path, event))

        return PluginCandidate(
            source="official",
            kind=kind,
            name=name,
            author=author,
            version=version,
            path=str(manifest_path),
            plugin_id=plugin_id,
            package_identity=package_identity,
            minimum_dify_version=minimum_dify_version,
            label=label,
            description=description,
            provider_id=provider_id,
            provider_name=provider_name,
            provider_refs=[str(ref) for ref in provider_refs],
            tools=tools,
            events=events,
            models=models,
            credential_requirements=credential_requirements,
            oauth_scopes=sorted(set(oauth_scopes)),
            resource=resource,
            docs=self._doc_summaries(manifest_path.parent),
        )

    def _credential_requirements(self, provider_path: Path, provider: dict[str, Any]) -> list[dict[str, Any]]:
        groups: list[dict[str, Any]] = []
        oauth_schema = provider.get("oauth_schema") if isinstance(provider.get("oauth_schema"), dict) else {}
        for name, fields in [
            ("credentials_schema", provider.get("credentials_schema")),
            (
                "provider_credential_schema.credential_form_schemas",
                (provider.get("provider_credential_schema") or {}).get("credential_form_schemas")
                if isinstance(provider.get("provider_credential_schema"), dict)
                else None,
            ),
            (
                "model_credential_schema.credential_form_schemas",
                (provider.get("model_credential_schema") or {}).get("credential_form_schemas")
                if isinstance(provider.get("model_credential_schema"), dict)
                else None,
            ),
            ("oauth_schema.client_schema", oauth_schema.get("client_schema")),
            ("oauth_schema.credentials_schema", oauth_schema.get("credentials_schema")),
            ("subscription_schema", provider.get("subscription_schema")),
        ]:
            group = schema_group(name, fields)
            if group:
                group["provider_path"] = str(provider_path)
                groups.append(group)

        constructor = provider.get("subscription_constructor")
        if isinstance(constructor, dict):
            for name, fields in [
                ("subscription_constructor.parameters", constructor.get("parameters")),
                ("subscription_constructor.credentials_schema", constructor.get("credentials_schema")),
            ]:
                group = schema_group(name, fields)
                if group:
                    group["provider_path"] = str(provider_path)
                    groups.append(group)
            oauth_schema = constructor.get("oauth_schema")
            if isinstance(oauth_schema, dict):
                for name, fields in [
                    ("subscription_constructor.oauth_schema.client_schema", oauth_schema.get("client_schema")),
                    (
                        "subscription_constructor.oauth_schema.credentials_schema",
                        oauth_schema.get("credentials_schema"),
                    ),
                ]:
                    group = schema_group(name, fields)
                    if group:
                        group["provider_path"] = str(provider_path)
                        groups.append(group)
        return groups

    def _model_summary(self, provider_path: Path, provider: dict[str, Any]) -> dict[str, Any]:
        models = provider.get("models") if isinstance(provider.get("models"), dict) else {}
        return {
            "provider": provider.get("provider") or provider_path.stem,
            "provider_path": str(provider_path),
            "supported_model_types": provider.get("supported_model_types") or [],
            "configurate_methods": provider.get("configurate_methods") or [],
            "model_groups": sorted(str(key) for key in models),
        }

    def _oauth_scopes(self, provider: dict[str, Any]) -> list[str]:
        scopes: list[str] = []
        oauth_schema = provider.get("oauth_schema")
        if isinstance(oauth_schema, dict):
            scopes.extend(str(scope) for scope in oauth_schema.get("scopes") or [])
        constructor = provider.get("subscription_constructor")
        if isinstance(constructor, dict):
            nested = constructor.get("oauth_schema")
            if isinstance(nested, dict):
                scopes.extend(str(scope) for scope in nested.get("scopes") or [])
        return scopes

    def _doc_summaries(self, plugin_dir: Path) -> list[dict[str, str]]:
        docs: list[dict[str, str]] = []
        candidates = [
            plugin_dir / "README.md",
            plugin_dir / "readme" / "README_zh_Hans.md",
            plugin_dir / "readme" / "README_en_US.md",
            plugin_dir / "PRIVACY.md",
        ]
        for path in candidates:
            if not path.exists():
                continue
            try:
                raw = path.read_text(errors="ignore")
            except OSError:
                continue
            lines = [line.strip() for line in raw.splitlines()]
            title = next((line.lstrip("#").strip() for line in lines if line.startswith("#")), path.name)
            non_empty = [line for line in lines if line and not line.startswith("#") and not line.startswith("!")]
            excerpt = " ".join(non_empty[:8])[:1200]
            docs.append({"path": str(path), "title": title, "excerpt": excerpt})
        return docs

    def _tool_summary(self, path: Path, tool: dict[str, Any]) -> dict[str, Any]:
        identity = tool.get("identity") or {}
        output_schema = tool.get("output_schema") or {}
        return {
            "name": identity.get("name") or path.stem,
            "label": label_text(identity.get("label")),
            "description": label_text((tool.get("description") or {}).get("human") or tool.get("description")),
            "parameters": [
                {
                    "name": param.get("name"),
                    "type": param.get("type"),
                    "required": param.get("required", False),
                    "form": param.get("form"),
                    "description": param.get("llm_description") or label_text(param.get("human_description")),
                }
                for param in tool.get("parameters") or []
                if isinstance(param, dict)
            ],
            "output_schema": output_schema,
            "path": str(path),
        }

    def _event_summary(self, path: Path, event: dict[str, Any]) -> dict[str, Any]:
        identity = event.get("identity") or {}
        return {
            "name": identity.get("name") or path.stem,
            "label": label_text(identity.get("label")),
            "description": label_text(event.get("description")),
            "parameters": [
                {
                    "name": param.get("name"),
                    "type": param.get("type"),
                    "required": param.get("required", False),
                    "description": label_text(param.get("description")),
                }
                for param in event.get("parameters") or []
                if isinstance(param, dict)
            ],
            "output_schema": event.get("output_schema") or {},
            "path": str(path),
        }

    def search_extracted_templates(self, request: str, limit: int = 8) -> list[dict[str, Any]]:
        strong_matches: list[dict[str, Any]] = []
        weak_matches: list[dict[str, Any]] = []
        for template in self.all_extracted_templates():
            score = token_score(request, str(template.get("_searchable") or "")) + identity_match_score(
                request,
                template_identity_terms(template),
            )
            if score <= 0:
                continue
            item = {key: value for key, value in template.items() if key != "_searchable"}
            item["score"] = score
            if score >= 2:
                strong_matches.append(item)
            else:
                weak_matches.append(item)

        selected = self.diversified_template_matches(strong_matches, limit)
        if len(selected) >= min(limit, 2):
            return selected
        selected_ids = {str(item.get("template_ref")) for item in selected}
        fallback = [item for item in weak_matches if str(item.get("template_ref")) not in selected_ids]
        return self.diversified_template_matches([*selected, *fallback], limit)

    def diversified_template_matches(self, matches: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
        sorted_matches = sorted(matches, key=lambda item: (-int(item["score"]), str(item["name"])))
        selected: list[dict[str, Any]] = []
        seen_plugins: set[str] = set()

        for item in sorted_matches:
            plugin_id = str(item.get("plugin_id") or item.get("provider_id") or item.get("name") or "")
            if plugin_id and plugin_id in seen_plugins:
                continue
            selected.append(item)
            if plugin_id:
                seen_plugins.add(plugin_id)
            if len(selected) >= limit:
                return selected

        selected_ids = {id(item) for item in selected}
        for item in sorted_matches:
            if id(item) in selected_ids:
                continue
            selected.append(item)
            if len(selected) >= limit:
                break
        return selected

    def all_extracted_templates(self) -> list[dict[str, Any]]:
        if self._extracted_templates_cache is not None:
            return self._extracted_templates_cache

        templates: list[dict[str, Any]] = []
        if not self.extracted_templates_dir.exists():
            self._extracted_templates_cache = templates
            return templates

        for template_path in sorted(self.extracted_templates_dir.rglob("*.yml")):
            raw = safe_load_yaml(template_path)
            node = raw.get("node") if isinstance(raw.get("node"), dict) else raw
            data = (node or {}).get("data") or {}
            searchable = " ".join(
                [
                    str(raw.get("name") or ""),
                    str(data.get("title") or ""),
                    str(data.get("type") or ""),
                    str(data.get("provider_id") or ""),
                    str(data.get("tool_name") or ""),
                    str(data.get("event_name") or ""),
                    str(data.get("plugin_unique_identifier") or ""),
                ]
            )
            dependencies = raw.get("dependencies") or raw.get("dependency") or []
            templates.append(
                {
                    "_searchable": searchable,
                    "source": "extracted_template",
                    "path": str(template_path),
                    "template_ref": template_ref(template_path),
                    "name": raw.get("name") or template_path.stem,
                    "node_type": data.get("type"),
                    "title": data.get("title"),
                    "plugin_id": data.get("plugin_id")
                    or plugin_id_from_unique_identifier(data.get("plugin_unique_identifier")),
                    "provider_id": data.get("provider_id"),
                    "tool_name": data.get("tool_name"),
                    "event_name": data.get("event_name"),
                    "plugin_unique_identifier": data.get("plugin_unique_identifier"),
                    "dependency_unique_identifiers": [
                        unique_identifier_from_dependency(dep)
                        for dep in dependencies
                        if isinstance(dep, dict) and unique_identifier_from_dependency(dep)
                    ],
                    "dependencies": dependencies,
                    "parameter_keys": sorted((data.get("tool_parameters") or {}).keys()),
                    "event_parameter_keys": sorted((data.get("event_parameters") or {}).keys()),
                }
            )

        self._extracted_templates_cache = templates
        return templates

    def dependency_evidence_by_plugin_id(self, extracted: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        grouped: dict[tuple[str, str], dict[str, Any]] = {}
        for template in extracted:
            dependencies = template.get("dependencies")
            if not isinstance(dependencies, list):
                continue
            for dependency in dependencies:
                if not isinstance(dependency, dict):
                    continue
                unique_identifier = unique_identifier_from_dependency(dependency)
                plugin_id = plugin_id_from_unique_identifier(unique_identifier)
                if not plugin_id:
                    continue
                key = (plugin_id, unique_identifier)
                entry = grouped.setdefault(
                    key,
                    {
                        "plugin_id": plugin_id,
                        "unique_identifier": unique_identifier,
                        "dependency": dependency,
                        "templates": [],
                        "tool_names": [],
                        "event_names": [],
                        "source": "extracted_template",
                    },
                )
                template_summary = {
                    "template_ref": template.get("template_ref"),
                    "template_path": template.get("path"),
                    "node_type": template.get("node_type"),
                    "tool_name": template.get("tool_name"),
                    "event_name": template.get("event_name"),
                }
                if template_summary not in entry["templates"]:
                    entry["templates"].append(template_summary)
                if template.get("tool_name") and template.get("tool_name") not in entry["tool_names"]:
                    entry["tool_names"].append(template.get("tool_name"))
                if template.get("event_name") and template.get("event_name") not in entry["event_names"]:
                    entry["event_names"].append(template.get("event_name"))

        evidence: dict[str, list[dict[str, Any]]] = {}
        for (plugin_id, _unique_identifier), entry in grouped.items():
            entry["tool_names"] = sorted(entry["tool_names"])
            entry["event_names"] = sorted(entry["event_names"])
            evidence.setdefault(plugin_id, []).append(entry)
        return evidence

    def link_official_to_templates(
        self,
        official: list[PluginCandidate],
        extracted: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        links: list[dict[str, Any]] = []
        seen: set[tuple[str, str, str, str]] = set()
        for candidate in official:
            tool_names = {str(tool.get("name")) for tool in candidate.tools if tool.get("name")}
            event_names = {str(event.get("name")) for event in candidate.events if event.get("name")}
            for template in extracted:
                provider_matches = template.get("provider_id") == candidate.provider_id
                if not provider_matches:
                    continue
                template_tool = template.get("tool_name")
                template_event = template.get("event_name")
                if template_tool and str(template_tool) in tool_names:
                    key = (
                        candidate.provider_id,
                        str(template_tool),
                        "",
                        str(template.get("plugin_unique_identifier") or ""),
                    )
                    if key in seen:
                        continue
                    seen.add(key)
                    links.append(
                        {
                            "provider_id": candidate.provider_id,
                            "official_plugin_id": candidate.plugin_id,
                            "official_package_identity": candidate.package_identity,
                            "name": candidate.name,
                            "official_version": candidate.version,
                            "template_path": template.get("path"),
                            "template_ref": template.get("template_ref"),
                            "node_type": template.get("node_type"),
                            "tool_name": template_tool,
                            "use_for": "tool_node_shape_and_dependency",
                            "plugin_unique_identifier": template.get("plugin_unique_identifier"),
                            "dependencies": template.get("dependencies"),
                            "exact_dependency_available": bool(template.get("dependencies")),
                        }
                    )
                if template_event and str(template_event) in event_names:
                    key = (
                        candidate.provider_id,
                        "",
                        str(template_event),
                        str(template.get("plugin_unique_identifier") or ""),
                    )
                    if key in seen:
                        continue
                    seen.add(key)
                    links.append(
                        {
                            "provider_id": candidate.provider_id,
                            "official_plugin_id": candidate.plugin_id,
                            "official_package_identity": candidate.package_identity,
                            "name": candidate.name,
                            "official_version": candidate.version,
                            "template_path": template.get("path"),
                            "template_ref": template.get("template_ref"),
                            "node_type": template.get("node_type"),
                            "event_name": template_event,
                            "use_for": "trigger_node_shape_and_dependency",
                            "plugin_unique_identifier": template.get("plugin_unique_identifier"),
                            "dependencies": template.get("dependencies"),
                            "exact_dependency_available": bool(template.get("dependencies")),
                        }
                    )
        return links


def main() -> int:
    parser = argparse.ArgumentParser(description="Resolve Dify plugin candidates from local repos.")
    parser.add_argument("request", help="Natural language request or plugin search terms.")
    parser.add_argument("--limit", type=int, default=8)
    args = parser.parse_args()
    result = PluginResolver().resolve(args.request, limit=args.limit)
    print(json.dumps(result, ensure_ascii=False, indent=2))  # noqa: T201
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
