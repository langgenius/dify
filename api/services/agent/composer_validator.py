import re
from typing import Any

from pydantic import ValidationError

from models.agent_config_entities import AgentKnowledgeQueryMode
from services.agent.errors import AgentSoulLockedError, InvalidComposerConfigError, PlaintextSecretNotAllowedError
from services.agent.prompt_mentions import (
    MAX_MENTIONS_PER_PROMPT,
    NODE_JOB_PROMPT_ALLOWED_KINDS,
    SOUL_PROMPT_ALLOWED_KINDS,
    MentionKind,
    MentionResolver,
    build_node_job_mention_resolver,
    build_soul_mention_resolver,
    find_malformed_mention_markers,
    parse_prompt_mentions,
)
from services.entities.agent_entities import (
    AgentSoulConfig,
    ComposerSavePayload,
    ComposerSaveStrategy,
    ComposerVariant,
    WorkflowNodeJobConfig,
)

_PLAINTEXT_SECRET_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "password",
    "secret",
    "secret_key",
}

# Env/secret names become shell ``export`` identifiers in the sandbox bootstrap, so
# they must be valid shell identifiers. Validating here fails fast at composer save
# with a friendly error instead of at run time in the agent backend shell layer.
_SHELL_ENV_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_CLI_TOOL_NAME_KEYS = ("name", "tool_name", "label")
_CLI_TOOL_COMMAND_KEYS = ("command", "install_command", "install", "setup_command")
_DENIED_PERMISSION_STATUSES = frozenset({"unauthorized", "denied", "forbidden", "invalid", "unavailable"})
_DANGEROUS_FLAG_KEYS = ("dangerous", "dangerous_command", "requires_confirmation")
_DANGEROUS_ACK_KEYS = (
    "dangerous_acknowledged",
    "dangerous_accepted",
    "risk_accepted",
    "approved",
)


class ComposerConfigValidator:
    @classmethod
    def validate_draft_save_payload(cls, payload: ComposerSavePayload) -> None:
        if (
            payload.variant == ComposerVariant.WORKFLOW
            and payload.soul_lock.locked
            and payload.agent_soul is not None
            and payload.save_strategy != ComposerSaveStrategy.NODE_JOB_ONLY
        ):
            raise AgentSoulLockedError()

    @classmethod
    def validate_save_payload(cls, payload: ComposerSavePayload) -> None:
        cls.validate_publish_payload(payload)

    @classmethod
    def validate_publish_payload(cls, payload: ComposerSavePayload) -> None:
        cls.validate_draft_save_payload(payload)
        if payload.agent_soul is not None:
            cls.validate_agent_soul(payload.agent_soul)
        if payload.node_job is not None:
            cls.validate_node_job(payload.node_job)
        cls._validate_prompt_mentions(payload)

    @classmethod
    def _validate_prompt_mentions(cls, payload: ComposerSavePayload) -> None:
        """ENG-616 §2.4 allowlists + ENG-617 §5.2 human-must-be-referenced.

        Error messages start with a stable code token (``mention_kind_not_allowed``
        / ``mention_limit_exceeded`` / ``human_involvement_not_referenced``) so
        the frontend can switch on it.
        """
        if payload.agent_soul is not None:
            cls._validate_surface_mentions(
                prompt=payload.agent_soul.prompt.system_prompt,
                allowed=SOUL_PROMPT_ALLOWED_KINDS,
                surface="agent soul prompt",
            )
            cls._require_human_mentions(
                prompt=payload.agent_soul.prompt.system_prompt,
                contacts=payload.agent_soul.human.contacts,
                surface="agent soul prompt",
            )
        if payload.node_job is not None:
            cls._validate_surface_mentions(
                prompt=payload.node_job.workflow_prompt,
                allowed=NODE_JOB_PROMPT_ALLOWED_KINDS,
                surface="workflow job prompt",
            )
            cls._require_human_mentions(
                prompt=payload.node_job.workflow_prompt,
                contacts=payload.node_job.human_contacts,
                surface="workflow job prompt",
            )

    @classmethod
    def _validate_surface_mentions(cls, *, prompt: str, allowed: frozenset[MentionKind], surface: str) -> None:
        mentions = parse_prompt_mentions(prompt)
        if len(mentions) > MAX_MENTIONS_PER_PROMPT:
            raise InvalidComposerConfigError(
                f"mention_limit_exceeded: {surface} has {len(mentions)} mentions, "
                f"exceeding the limit of {MAX_MENTIONS_PER_PROMPT}."
            )
        for mention in mentions:
            if mention.kind not in allowed:
                raise InvalidComposerConfigError(
                    f"mention_kind_not_allowed: {surface} cannot reference {mention.kind.value} (id={mention.ref_id})."
                )

    @classmethod
    def _require_human_mentions(cls, *, prompt: str, contacts: list[Any], surface: str) -> None:
        """ENG-617 §5.2 (PRD: human involvement must be slash-referenced or save errors).

        Every configured human contact must appear as ``{{#human:<id>#}}`` in the
        corresponding prompt. A contact matches via any identity alias; contacts
        carrying no identity at all cannot be referenced and are skipped.
        """
        if not contacts:
            return
        mentioned = {mention.ref_id for mention in parse_prompt_mentions(prompt) if mention.kind == MentionKind.HUMAN}
        for contact in contacts:
            aliases = {
                alias
                for alias in (contact.id, contact.contact_id, contact.human_id, contact.email, contact.name)
                if alias
            }
            if not aliases:
                continue
            if aliases.isdisjoint(mentioned):
                display = contact.name or contact.email or contact.id or "human involvement"
                raise InvalidComposerConfigError(
                    f"human_involvement_not_referenced: configured human involvement '{display}' "
                    f"must be referenced in the {surface} via the slash menu."
                )

    @classmethod
    def collect_soft_findings(
        cls,
        payload: ComposerSavePayload,
        *,
        existing_knowledge_set_ids: set[str] | None = None,
    ) -> dict[str, Any]:
        """ENG-617 §5.3/§5.4 soft findings — never block save.

        ``warnings`` carries ``mention_target_missing`` / ``mention_malformed``
        entries; ``knowledge_retrieval_placeholder`` keeps dangling knowledge-set
        mentions with a placeholder name (0522 consensus) instead of dropping or
        rejecting them. With ``existing_knowledge_set_ids`` provided, mentions
        that no longer exist in the current Agent Soul surface as placeholders too.
        """
        warnings: list[dict[str, Any]] = []
        placeholders: list[dict[str, str]] = []

        surfaces: list[tuple[str, str, MentionResolver, frozenset[MentionKind]]] = []
        if payload.agent_soul is not None:
            surfaces.append(
                (
                    "agent_soul",
                    payload.agent_soul.prompt.system_prompt,
                    build_soul_mention_resolver(payload.agent_soul),
                    SOUL_PROMPT_ALLOWED_KINDS,
                )
            )
        if payload.node_job is not None:
            surfaces.append(
                (
                    "node_job",
                    payload.node_job.workflow_prompt,
                    build_node_job_mention_resolver(payload.node_job),
                    NODE_JOB_PROMPT_ALLOWED_KINDS,
                )
            )

        for surface, prompt, resolver, allowed in surfaces:
            for mention in parse_prompt_mentions(prompt):
                if mention.kind not in allowed:
                    continue  # hard-rejected by validate_save_payload
                resolved = resolver(mention)
                if mention.kind == MentionKind.KNOWLEDGE:
                    dangling = resolved is None or (
                        existing_knowledge_set_ids is not None and mention.ref_id not in existing_knowledge_set_ids
                    )
                    if dangling:
                        placeholders.append(
                            {
                                "id": mention.ref_id,
                                "placeholder_name": mention.label or f"Knowledge {mention.ref_id[:8]}",
                            }
                        )
                    continue
                if mention.kind in {MentionKind.SKILL, MentionKind.FILE}:
                    continue
                if resolved is None:
                    warnings.append(
                        {
                            "code": "mention_target_missing",
                            "surface": surface,
                            "kind": mention.kind.value,
                            "id": mention.ref_id,
                            "message": f"{mention.kind.value} mention (id={mention.ref_id}) does not match "
                            "any configured item.",
                        }
                    )
            for marker in find_malformed_mention_markers(prompt):
                warnings.append(
                    {
                        "code": "mention_malformed",
                        "surface": surface,
                        "kind": None,
                        "id": None,
                        "message": f"mention-shaped marker {marker!r} is malformed and will be "
                        "degraded to plain text at runtime.",
                    }
                )

        return {"warnings": warnings, "knowledge_retrieval_placeholder": placeholders}

    @classmethod
    def validate_agent_soul(cls, agent_soul: AgentSoulConfig) -> None:
        dumped = agent_soul.model_dump(mode="json")
        cls._reject_missing_config_assets(agent_soul)
        cls._validate_knowledge_runtime_config(agent_soul)
        cls._reject_plaintext_secrets(dumped, path="agent_soul")
        cls._validate_shell_config(dumped)

    @staticmethod
    def _reject_missing_config_assets(agent_soul: AgentSoulConfig) -> None:
        missing = [f"skill:{item.name}" for item in agent_soul.config_skills if item.is_missing]
        missing.extend(f"file:{item.name}" for item in agent_soul.config_files if item.is_missing)
        if missing:
            raise InvalidComposerConfigError(
                "config_asset_missing: upload the missing Agent config assets before publishing: " + ", ".join(missing)
            )

    @classmethod
    def _validate_knowledge_runtime_config(cls, agent_soul: AgentSoulConfig) -> None:
        """Validate knowledge settings that are required only for publish/run.

        Draft composer saves must be able to persist partially configured
        knowledge sets while a user is still editing the panel. These checks
        stay in the publish validator so invalid runtime configs are still
        blocked before a version can be published or executed.
        """
        for knowledge_set in agent_soul.knowledge.sets:
            if (
                knowledge_set.query.mode == AgentKnowledgeQueryMode.USER_QUERY
                and not (knowledge_set.query.value or "").strip()
            ):
                raise InvalidComposerConfigError("knowledge query.value is required for user_query mode")

            retrieval = knowledge_set.retrieval
            if retrieval.mode == "multiple" and retrieval.top_k is None:
                raise InvalidComposerConfigError("knowledge retrieval.top_k is required for multiple mode")
            if retrieval.mode == "single" and retrieval.model is None:
                raise InvalidComposerConfigError("knowledge retrieval.model is required for single mode")

            metadata_filtering = knowledge_set.metadata_filtering
            if metadata_filtering.mode == "automatic" and metadata_filtering.metadata_model_config is None:
                raise InvalidComposerConfigError("metadata_filtering.model_config is required for automatic mode")
            if metadata_filtering.mode == "manual" and (
                metadata_filtering.conditions is None or not metadata_filtering.conditions.conditions
            ):
                raise InvalidComposerConfigError("metadata_filtering.conditions is required for manual mode")

    @classmethod
    def validate_node_job(cls, node_job: WorkflowNodeJobConfig) -> None:
        cls._reject_plaintext_secrets(node_job.model_dump(mode="json"), path="node_job")

    @classmethod
    def validate_agent_soul_dict(cls, value: dict[str, Any]) -> AgentSoulConfig:
        try:
            config = AgentSoulConfig.model_validate(value)
        except ValidationError as exc:
            raise InvalidComposerConfigError(str(exc)) from exc
        cls.validate_agent_soul(config)
        return config

    @classmethod
    def validate_node_job_dict(cls, value: dict[str, Any]) -> WorkflowNodeJobConfig:
        try:
            config = WorkflowNodeJobConfig.model_validate(value)
        except ValidationError as exc:
            raise InvalidComposerConfigError(str(exc)) from exc
        cls.validate_node_job(config)
        return config

    @classmethod
    def _validate_shell_config(cls, soul: dict[str, Any]) -> None:
        """Fail fast on shell env/secret/CLI config the sandbox would otherwise reject at run time."""
        seen_env_names: set[str] = set()
        env = soul.get("env") or {}
        cls._validate_env_config(env, seen_env_names=seen_env_names, label="agent")

        tools = soul.get("tools") or {}
        cli_tools = tools.get("cli_tools")
        if isinstance(cli_tools, list):
            # Mention references resolve `[§cli_tool:<id>§]` by id, so ids must be
            # unique across the whole list — disabled entries included, since they
            # stay in config and would make resolution ambiguous.
            seen_cli_tool_ids: set[str] = set()
            for entry in cli_tools:
                if not isinstance(entry, dict):
                    continue
                raw_id = entry.get("id")
                if isinstance(raw_id, str) and raw_id.strip():
                    if raw_id in seen_cli_tool_ids:
                        raise InvalidComposerConfigError(
                            f"duplicate CLI tool id '{raw_id}': cli_tool mention references require unique ids."
                        )
                    seen_cli_tool_ids.add(raw_id)
            for entry in cli_tools:
                if not isinstance(entry, dict) or entry.get("enabled") is False:
                    continue
                has_name = any(isinstance(entry.get(key), str) and entry[key].strip() for key in _CLI_TOOL_NAME_KEYS)
                has_command = cls._has_install_command(entry)
                if not has_name and not has_command:
                    raise InvalidComposerConfigError("an enabled CLI tool must declare a name or an install command.")
                if cls._permission_denied(entry) or entry.get("pre_authorized") is False:
                    raise InvalidComposerConfigError("an enabled CLI tool is not authorized for runtime bootstrap.")
                if cls._dangerous_without_acknowledgement(entry):
                    raise InvalidComposerConfigError(
                        "a dangerous CLI tool command must be explicitly acknowledged before save."
                    )
                tool_name = cls._cli_tool_name(entry) or "<unnamed>"
                cls._validate_env_config(
                    entry.get("env") or {},
                    seen_env_names=seen_env_names,
                    label=f"CLI tool '{tool_name}'",
                )

    @classmethod
    def _validate_env_config(cls, env: Any, *, seen_env_names: set[str], label: str) -> None:
        if not isinstance(env, dict):
            return
        for section in ("variables", "secret_refs"):
            entries = env.get(section)
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                name = cls._env_name(entry)
                if name is None:
                    # Unnamed draft rows are tolerated; only named entries are bound to the shell.
                    continue
                if not _SHELL_ENV_NAME_PATTERN.fullmatch(name):
                    raise InvalidComposerConfigError(
                        f"env/secret name '{name}' must be a valid shell identifier (^[A-Za-z_][A-Za-z0-9_]*$)."
                    )
                if section == "secret_refs" and cls._permission_denied(entry):
                    raise InvalidComposerConfigError(f"secret reference '{name}' is not authorized for {label}.")
                if name in seen_env_names:
                    raise InvalidComposerConfigError(
                        f"duplicate env/secret name '{name}': environment variables and secret references "
                        "share the shell namespace."
                    )
                seen_env_names.add(name)

    @staticmethod
    def _env_name(entry: dict[str, Any]) -> str | None:
        for key in ("name", "key", "env_name", "variable"):
            value = entry.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @staticmethod
    def _cli_tool_name(entry: dict[str, Any]) -> str | None:
        for key in _CLI_TOOL_NAME_KEYS:
            value = entry.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    @classmethod
    def _reject_plaintext_secrets(cls, value: Any, *, path: str) -> None:
        match value:
            case dict():
                for key, nested in value.items():
                    normalized_key = key.lower().replace("-", "_")
                    nested_path = f"{path}.{key}"
                    if normalized_key in _PLAINTEXT_SECRET_KEYS and isinstance(nested, str) and nested:
                        raise PlaintextSecretNotAllowedError(f"Plaintext secret is not allowed at {nested_path}")
                    cls._reject_plaintext_secrets(nested, path=nested_path)
            case list():
                for index, nested in enumerate(value):
                    cls._reject_plaintext_secrets(nested, path=f"{path}[{index}]")

    @classmethod
    def _has_install_command(cls, entry: dict[str, Any]) -> bool:
        raw_commands = entry.get("install_commands")
        if isinstance(raw_commands, list) and any(
            isinstance(command, str) and command.strip() for command in raw_commands
        ):
            return True
        return any(isinstance(entry.get(key), str) and entry[key].strip() for key in _CLI_TOOL_COMMAND_KEYS)

    @classmethod
    def _permission_denied(cls, entry: dict[str, Any]) -> bool:
        permission = entry.get("permission")
        if isinstance(permission, dict):
            allowed = permission.get("allowed")
            if allowed is False:
                return True
            status = permission.get("status") or permission.get("state")
            if isinstance(status, str) and status in _DENIED_PERMISSION_STATUSES:
                return True

        for key in ("authorization_status", "permission_status", "status"):
            status = entry.get(key)
            if isinstance(status, str) and status in _DENIED_PERMISSION_STATUSES:
                return True
        return False

    @classmethod
    def _dangerous_without_acknowledgement(cls, entry: dict[str, Any]) -> bool:
        dangerous = any(entry.get(key) is True for key in _DANGEROUS_FLAG_KEYS)
        risk_level = entry.get("risk_level")
        if isinstance(risk_level, str) and risk_level == "dangerous":
            dangerous = True
        if not dangerous:
            return False
        return not any(entry.get(key) is True for key in _DANGEROUS_ACK_KEYS)
