"""Account-scoped PAT lifecycle policies; the store owns transactions."""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Literal, Protocol

from constants.oauth_bearer import TokenType
from constants.personal_access_token import PersonalAccessTokenPolicy
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from machinery.context import AccountRequestContext, RequestContext
from services.app.console_service import ConsoleAppService
from services.entities.app_entities import AppListParams
from services.knowledge.datasets.application import DatasetApplicationService, DatasetListFilter

logger = logging.getLogger(__name__)


class PersonalAccessTokenNotFoundError(Exception):
    """No live PAT is owned by the requesting account."""


class PersonalAccessTokenExpiredError(Exception):
    """An expired PAT cannot be copied or edited."""


class PersonalAccessTokenCreateConflictError(Exception):
    """An idempotency key was reused for a different or revoked creation."""


class PersonalAccessTokenAccessDeniedError(Exception):
    """A newly selected object is unavailable to this account."""


class PersonalAccessTokenUpdateConflictError(Exception):
    """Another edit changed the PAT since this draft was loaded."""


class PersonalAccessTokenInvalidError(Exception):
    """A bearer does not identify a live PAT and active holder."""


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenGrant:
    """Discovery filters: None leaves that domain unrestricted by the PAT;
    an empty set denies every object; a nonempty set permits only those IDs.
    Current account permissions remain mandatory for all three cases.
    """

    app_ids: frozenset[str] | None = None
    workspace_ids: frozenset[str] | None = None


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenResourceRef:
    resource_type: Literal["app", "dataset", "app_runner"]
    resource_id: str


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenScopes:
    resource_mode: Literal["all", "selected", "none"] = "all"
    resources: tuple[PersonalAccessTokenResourceRef, ...] = ()
    workspace_mode: Literal["all", "selected", "none"] = "all"
    workspace_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenResourceView:
    resource_type: str
    resource_id: str
    workspace_id: str
    display_name: str
    workspace_name: str
    available: bool
    reason: str | None
    maintainer: str | None = None
    api_enabled: bool = True
    parent_app_id: str | None = None
    display_name_snapshot: str = ""
    workspace_name_snapshot: str = ""
    app_runners: tuple[PersonalAccessTokenResourceView, ...] = ()


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenWorkspaceView:
    workspace_id: str
    display_name: str
    available: bool
    reason: str | None
    role: str | None = None


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenResourcePage:
    data: tuple[PersonalAccessTokenResourceView, ...]
    next_cursor: int | None

    @property
    def has_more(self) -> bool:
        return self.next_cursor is not None


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenWorkspacePage:
    data: tuple[PersonalAccessTokenWorkspaceView, ...]
    next_cursor: int | None

    @property
    def has_more(self) -> bool:
        return self.next_cursor is not None


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenSummary:
    id: str
    name: str
    secret_last_four: str
    created_at: datetime
    expires_at: datetime | None
    resource_scope_mode: str
    workspace_scope_mode: str
    version: int = 1
    has_access_issue: bool = False
    last_used_at: datetime | None = None
    resource_count: int = 0
    workspace_count: int = 0
    unavailable_count: int = 0

    @property
    def status(self) -> Literal["active", "expired", "access_issue"]:
        if self.expires_at is not None and self.expires_at <= naive_utc_now():
            return "expired"
        return "access_issue" if self.has_access_issue else "active"


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenDetails:
    token: PersonalAccessTokenSummary
    resources: tuple[PersonalAccessTokenResourceView, ...]
    workspaces: tuple[PersonalAccessTokenWorkspaceView, ...]


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenRecord:
    summary: PersonalAccessTokenSummary
    account_id: str
    secret_digest: str = field(repr=False)
    secret_ciphertext: bytes = field(repr=False)
    creation_key: str | None = None
    creation_fingerprint: str | None = None
    scopes: PersonalAccessTokenScopes = PersonalAccessTokenScopes()
    validated_resources: tuple[PersonalAccessTokenResourceView, ...] = field(default=(), repr=False)


@dataclass(frozen=True, slots=True)
class PersonalAccessTokenDeploymentSnapshot:
    current_workspace_id: str | None
    resources: tuple[PersonalAccessTokenResourceView, ...]


class PersonalAccessTokenDeploymentCatalog(Protocol):
    def snapshot(self, account_id: str) -> PersonalAccessTokenDeploymentSnapshot: ...


class PersonalAccessTokenCatalogUnavailableError(Exception):
    """Deployment metadata could not be checked; this is not permission loss."""


class PersonalAccessTokenStore(Protocol):
    def create(self, record: PersonalAccessTokenRecord) -> PersonalAccessTokenSummary: ...

    def find_creation(self, account_id: str, key: str, fingerprint: str) -> PersonalAccessTokenSummary | None: ...

    def list_details(self, account_id: str, *, page: int, limit: int) -> tuple[PersonalAccessTokenDetails, ...]: ...

    def count_tokens(self, account_id: str) -> int: ...

    def get(self, account_id: str, token_id: str) -> PersonalAccessTokenRecord: ...

    def find_by_digest(self, digest: str, *, now: datetime) -> PersonalAccessTokenRecord | None: ...

    def revoke(self, account_id: str, token_id: str) -> None: ...

    def details(self, account_id: str, token_id: str) -> PersonalAccessTokenDetails: ...

    def update(
        self,
        account_id: str,
        token_id: str,
        *,
        name: str,
        version: int,
        scopes: PersonalAccessTokenScopes | None,
        now: datetime,
        validated_resources: tuple[PersonalAccessTokenResourceView, ...],
    ) -> PersonalAccessTokenDetails: ...

    def current_workspace(self, account_id: str) -> PersonalAccessTokenWorkspaceView | None: ...

    def workspace_candidates(
        self,
        account_id: str,
        *,
        keyword: str | None,
        offset: int = 0,
        limit: int | None = None,
    ) -> tuple[PersonalAccessTokenWorkspaceView, ...]: ...


class PersonalAccessTokenCipher(Protocol):
    def encrypt(self, secret: str, *, token_id: str, account_id: str) -> bytes: ...

    def decrypt(self, ciphertext: bytes, *, token_id: str, account_id: str) -> str: ...


class PersonalAccessTokenService:
    def __init__(
        self,
        *,
        tokens: PersonalAccessTokenStore,
        cipher: PersonalAccessTokenCipher,
        apps: ConsoleAppService,
        datasets: DatasetApplicationService,
        deployments: PersonalAccessTokenDeploymentCatalog,
    ) -> None:
        self._tokens = tokens
        self._cipher = cipher
        self._apps = apps
        self._datasets = datasets
        self._deployments = deployments

    def create(
        self,
        context: AccountRequestContext,
        *,
        name: str,
        expiration_days: int | None,
        creation_key: str | None = None,
        scopes: PersonalAccessTokenScopes,
    ) -> PersonalAccessTokenSummary:
        name = name.strip()
        if not name or len(name) > 255:
            raise ValueError("Name must contain between 1 and 255 characters.")
        if expiration_days not in (30, 90, 180, 365, None):
            raise ValueError("Unsupported expiration.")
        if creation_key is not None and (not creation_key.strip() or len(creation_key) > 128):
            raise ValueError("Idempotency-Key must contain between 1 and 128 characters.")
        self._validate_scopes(scopes)
        fingerprint = hashlib.sha256(
            json.dumps(
                [
                    name,
                    expiration_days,
                    scopes.resource_mode,
                    sorted((r.resource_type, r.resource_id) for r in scopes.resources),
                    scopes.workspace_mode,
                    sorted(scopes.workspace_ids),
                ]
            ).encode()
        ).hexdigest()
        if creation_key is not None:
            previous = self._tokens.find_creation(context.account_id, creation_key, fingerprint)
            if previous is not None:
                return self.details(context, token_id=previous.id).token
        validated = self._validate_app_runner_resources(context.account_id, scopes, existing=frozenset())
        token_id = str(uuidv7())
        secret = f"{TokenType.PERSONAL_ACCESS.prefix}{secrets.token_urlsafe(32)}"
        now = naive_utc_now()
        summary = PersonalAccessTokenSummary(
            id=token_id,
            name=name,
            secret_last_four=secret[-4:],
            created_at=now,
            expires_at=now + timedelta(days=expiration_days) if expiration_days else None,
            resource_scope_mode=scopes.resource_mode,
            workspace_scope_mode=scopes.workspace_mode,
            resource_count=len(scopes.resources),
            workspace_count=len(scopes.workspace_ids),
        )
        created = self._tokens.create(
            PersonalAccessTokenRecord(
                summary=summary,
                account_id=context.account_id,
                secret_digest=hashlib.sha256(secret.encode()).hexdigest(),
                secret_ciphertext=self._cipher.encrypt(secret, token_id=token_id, account_id=context.account_id),
                creation_key=creation_key,
                creation_fingerprint=fingerprint,
                scopes=scopes,
                validated_resources=validated,
            )
        )
        logger.info(
            "PAT created account_id=%s token_id=%s trace_id=%s",
            context.account_id,
            created.id,
            context.trace_id,
        )
        # The validated selections and repository transaction already establish the
        # creation response. A second remote lookup could fail after the write.
        return created

    def list_tokens(
        self, context: AccountRequestContext, *, page: int, limit: int
    ) -> tuple[PersonalAccessTokenSummary, ...]:
        rows = self._tokens.list_details(context.account_id, page=page, limit=limit)
        decisions = self._configuration_decisions(context.account_id, tuple(r for row in rows for r in row.resources))
        deployments = self._deployment_snapshot(context.account_id, rows)
        return tuple(self._project_access(context.account_id, row, decisions, deployments).token for row in rows)

    def count_tokens(self, context: AccountRequestContext) -> int:
        return self._tokens.count_tokens(context.account_id)

    def authenticate(self, secret: str) -> PersonalAccessTokenRecord:
        if not secret.startswith(TokenType.PERSONAL_ACCESS.prefix) or len(secret) > 128:
            raise PersonalAccessTokenInvalidError()
        record = self._tokens.find_by_digest(hashlib.sha256(secret.encode()).hexdigest(), now=naive_utc_now())
        if record is None:
            raise PersonalAccessTokenInvalidError()
        return record

    def authorize(
        self,
        *,
        account_id: str,
        token_id: str,
        policy: PersonalAccessTokenPolicy,
        workspace_id: str | None,
        app_id: str | None,
    ) -> PersonalAccessTokenGrant:
        record = self._tokens.get(account_id, token_id)
        if record.summary.expires_at is not None and record.summary.expires_at <= naive_utc_now():
            raise PersonalAccessTokenInvalidError()
        if policy in {PersonalAccessTokenPolicy.WORKSPACE_DISCOVERY, PersonalAccessTokenPolicy.IDENTITY_DISCOVERY}:
            mode = record.scopes.workspace_mode
            return PersonalAccessTokenGrant(
                workspace_ids=(
                    None
                    if mode == "all"
                    else frozenset(record.scopes.workspace_ids)
                    if mode == "selected"
                    else frozenset()
                )
            )
        if policy is PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS:
            scopes = record.scopes
            if scopes.workspace_mode == "none" or (
                scopes.workspace_mode == "selected" and workspace_id not in scopes.workspace_ids
            ):
                raise PersonalAccessTokenAccessDeniedError("Workspace is outside the PAT scope.")
            if workspace_id not in {
                w.workspace_id for w in self._tokens.workspace_candidates(account_id, keyword=None)
            }:
                raise PersonalAccessTokenAccessDeniedError("Current workspace membership is unavailable.")
            return PersonalAccessTokenGrant()
        if policy in {PersonalAccessTokenPolicy.RESOURCE_CALLS, PersonalAccessTokenPolicy.RESOURCE_DISCOVERY}:
            scopes = record.scopes
            selected = frozenset(r.resource_id for r in scopes.resources if r.resource_type == "app")
            if policy is PersonalAccessTokenPolicy.RESOURCE_CALLS and (
                scopes.resource_mode == "none" or (scopes.resource_mode == "selected" and app_id not in selected)
            ):
                raise PersonalAccessTokenAccessDeniedError("App is outside the PAT scope.")
            # Endpoint guards own account RBAC, WebApp access and API switches.
            # A PAT only restricts the resources those existing guards may admit.
            return PersonalAccessTokenGrant(
                app_ids=None
                if scopes.resource_mode == "all"
                else selected
                if scopes.resource_mode == "selected"
                else frozenset()
            )
        raise PersonalAccessTokenAccessDeniedError("Unsupported PAT operation.")

    def copy_secret(self, context: AccountRequestContext, *, token_id: str) -> str:
        record = self._tokens.get(context.account_id, token_id)
        if record.summary.expires_at is not None and record.summary.expires_at <= naive_utc_now():
            raise PersonalAccessTokenExpiredError()
        secret = self._cipher.decrypt(record.secret_ciphertext, token_id=token_id, account_id=context.account_id)
        logger.info(
            "PAT secret retrieved account_id=%s token_id=%s trace_id=%s", context.account_id, token_id, context.trace_id
        )
        return secret

    def revoke(self, context: AccountRequestContext, *, token_id: str) -> None:
        self._tokens.revoke(context.account_id, token_id)
        logger.info("PAT revoked account_id=%s token_id=%s trace_id=%s", context.account_id, token_id, context.trace_id)

    def details(self, context: AccountRequestContext, *, token_id: str) -> PersonalAccessTokenDetails:
        details = self._tokens.details(context.account_id, token_id)
        return self._project_access(
            context.account_id, details, {}, self._deployment_snapshot(context.account_id, (details,))
        )

    def _configuration_decisions(
        self, account_id: str, resources: Sequence[PersonalAccessTokenResourceView]
    ) -> dict[tuple[str, str], bool]:
        visible: set[tuple[str, str]] = set()
        # Saved references carry their trusted owner workspace. Check only those
        # references; switching workspace must not revoke an existing selection.
        by_workspace: dict[str, list[PersonalAccessTokenResourceView]] = {}
        for resource in resources:
            if resource.available and resource.resource_type != "app_runner":
                by_workspace.setdefault(resource.workspace_id, []).append(resource)
        for workspace_id, selected in by_workspace.items():
            context = RequestContext(
                request_id="", trace_id=None, account_id=account_id, active_workspace_id=workspace_id
            )
            visible.update(
                (r.resource_type, r.resource_id)
                for r in self._list_selected_resources(
                    context,
                    workspace_name=selected[0].workspace_name,
                    resource_refs=frozenset((r.resource_type, r.resource_id) for r in selected),
                )
            )
        return {
            (r.resource_type, r.resource_id): r.resource_type == "app_runner"
            or (r.resource_type, r.resource_id) in visible
            for r in resources
            if r.available
        }

    def _project_access(
        self,
        account_id: str,
        details: PersonalAccessTokenDetails,
        decisions: dict[tuple[str, str], bool],
        deployments: PersonalAccessTokenDeploymentSnapshot | None,
    ) -> PersonalAccessTokenDetails:
        if deployments is not None:
            current = {r.resource_id: r for r in deployments.resources}
            runners_by_app: dict[str, list[PersonalAccessTokenResourceView]] = {}
            for runner in deployments.resources:
                if runner.parent_app_id is not None:
                    runners_by_app.setdefault(runner.parent_app_id, []).append(runner)
            projected = []
            for resource in details.resources:
                if resource.resource_type == "app":
                    resource = replace(
                        resource,
                        app_runners=tuple(runners_by_app.get(resource.resource_id, ())),
                    )
                if resource.resource_type != "app_runner" or not resource.available:
                    projected.append(resource)
                    continue
                if resource.workspace_id != deployments.current_workspace_id:
                    # Switching the Console workspace does not revoke a saved grant.
                    projected.append(replace(resource, available=False, reason="workspace_not_current"))
                    continue
                live = current.get(resource.resource_id)
                if live is not None and live.workspace_id == resource.workspace_id:
                    projected.append(
                        replace(
                            live,
                            display_name_snapshot=resource.display_name_snapshot,
                            workspace_name_snapshot=resource.workspace_name_snapshot,
                        )
                    )
                else:
                    projected.append(replace(resource, available=False, reason="access_removed"))
            details = replace(details, resources=tuple(projected))
        unchecked = tuple(
            r for r in details.resources if r.available and (r.resource_type, r.resource_id) not in decisions
        )
        decisions.update(self._configuration_decisions(account_id, unchecked))
        resources = tuple(
            resource
            if not resource.available or decisions[(resource.resource_type, resource.resource_id)]
            else replace(
                resource,
                available=False,
                reason="access_removed",
                display_name=resource.display_name_snapshot,
                workspace_name=resource.workspace_name_snapshot,
            )
            for resource in details.resources
        )
        return self._with_access_summary(replace(details, resources=resources))

    @staticmethod
    def _with_access_summary(details: PersonalAccessTokenDetails) -> PersonalAccessTokenDetails:
        resources = details.resources
        token = replace(
            details.token,
            has_access_issue=any(
                not item.available and item.reason != "workspace_not_current"
                for item in (*resources, *details.workspaces)
            ),
            resource_count=len(resources),
            workspace_count=len(details.workspaces),
            unavailable_count=sum(
                not item.available and item.reason != "workspace_not_current"
                for item in (*resources, *details.workspaces)
            ),
        )
        return replace(details, token=token, resources=resources)

    def _deployment_snapshot(
        self, account_id: str, details: tuple[PersonalAccessTokenDetails, ...]
    ) -> PersonalAccessTokenDeploymentSnapshot | None:
        if any(r.resource_type in ("app", "app_runner") for row in details for r in row.resources):
            return self._deployments.snapshot(account_id)
        return None

    def update(
        self,
        context: AccountRequestContext,
        *,
        token_id: str,
        name: str,
        version: int,
        scopes: PersonalAccessTokenScopes | None,
    ) -> PersonalAccessTokenDetails:
        name = name.strip()
        if not name or len(name) > 255:
            raise ValueError("Name must contain between 1 and 255 characters.")
        original = self._tokens.details(context.account_id, token_id)
        validated = ()
        if scopes is not None:
            self._validate_scopes(scopes)
            validated = self._validate_app_runner_resources(
                context.account_id,
                scopes,
                existing=frozenset((r.resource_type, r.resource_id) for r in original.resources),
            )
        wanted = (
            {(r.resource_type, r.resource_id) for r in scopes.resources}
            if scopes is not None
            else {(r.resource_type, r.resource_id) for r in original.resources}
        )
        retained = tuple(r for r in original.resources if (r.resource_type, r.resource_id) in wanted)
        pending = replace(original, resources=(*retained, *validated))
        # Resolve every fallible remote read before starting the write transaction.
        # The response uses this request's access snapshot and the committed values.
        deployments = self._deployment_snapshot(context.account_id, (pending,))
        saved = self._tokens.update(
            context.account_id,
            token_id,
            name=name,
            version=version,
            scopes=scopes,
            now=naive_utc_now(),
            validated_resources=validated,
        )
        logger.info(
            "PAT updated account_id=%s token_id=%s trace_id=%s",
            context.account_id,
            token_id,
            context.trace_id,
        )
        return self._project_access(
            context.account_id,
            saved,
            {},
            deployments,
        )

    def resource_candidates(
        self,
        context: AccountRequestContext,
        *,
        keyword: str | None,
        cursor: int,
        limit: int,
    ) -> PersonalAccessTokenResourcePage:
        workspaces = self._tokens.workspace_candidates(context.account_id, keyword=None)
        candidates = self._list_resource_candidates_across_workspaces(
            context,
            workspaces=workspaces,
            keyword=keyword,
            offset=cursor,
            limit=limit + 1,
        )
        page = candidates[:limit]
        app_ids = {resource.resource_id for resource in page if resource.resource_type == "app"}
        if app_ids:
            runners_by_app: dict[str, list[PersonalAccessTokenResourceView]] = {}
            for runner in self._deployments.snapshot(context.account_id).resources:
                if runner.parent_app_id in app_ids:
                    runners_by_app.setdefault(runner.parent_app_id, []).append(runner)
            page = tuple(
                replace(resource, app_runners=tuple(runners_by_app.get(resource.resource_id, ())))
                if resource.resource_type == "app"
                else resource
                for resource in page
            )
        return PersonalAccessTokenResourcePage(page, cursor + limit if len(candidates) > limit else None)

    def _list_resource_candidates_across_workspaces(
        self,
        context: AccountRequestContext,
        *,
        workspaces: Sequence[PersonalAccessTokenWorkspaceView],
        keyword: str | None,
        offset: int,
        limit: int,
    ) -> tuple[PersonalAccessTokenResourceView, ...]:
        """Page through account-visible candidates while preserving workspace list access rules."""
        prefix_limit = offset + limit
        resources: list[PersonalAccessTokenResourceView] = []
        for workspace in workspaces:
            search = keyword
            if keyword and keyword.casefold() in f"{workspace.display_name} {workspace.workspace_id}".casefold():
                search = None
            workspace_context = RequestContext(
                request_id=context.request_id,
                trace_id=context.trace_id,
                account_id=context.account_id,
                active_workspace_id=workspace.workspace_id,
            )
            for kind in ("app", "dataset"):
                page = 1
                count = 0
                has_more = True
                while has_more and count < prefix_limit:
                    values, has_more = self._fetch_resource_page(
                        workspace_context, workspace.display_name, kind, search, page, None
                    )
                    values = values[: prefix_limit - count]
                    resources.extend(self._resource_views(kind, values))
                    count += len(values)
                    page += 1
        resources.sort(key=lambda r: (r.display_name, r.resource_type, r.resource_id, r.workspace_id))
        return tuple(resources[offset : offset + limit])

    def _list_selected_resources(
        self,
        context: RequestContext,
        *,
        workspace_name: str,
        resource_refs: frozenset[tuple[str, str]],
    ) -> tuple[PersonalAccessTokenResourceView, ...]:
        """Resolve selected resource references in batches of at most 100 IDs."""
        resources = []
        for kind in ("app", "dataset"):
            selected_ids = sorted(resource_id for resource_type, resource_id in resource_refs if resource_type == kind)
            for start in range(0, len(selected_ids), 100):
                values, _ = self._fetch_resource_page(
                    context, workspace_name, kind, None, 1, selected_ids[start : start + 100]
                )
                resources.extend(self._resource_views(kind, values))
        return tuple(resources)

    def _fetch_resource_page(
        self,
        context: RequestContext,
        workspace_name: str,
        kind: str,
        keyword: str | None,
        page: int,
        ids: Sequence[str] | None,
    ) -> tuple[list[tuple[str, str, str | None, bool, str, str]], bool]:
        if kind == "app":
            result = self._apps.list_apps(
                context,
                AppListParams(
                    page=page,
                    limit=100,
                    name=keyword,
                    status="normal",
                    for_selection=True,
                    resource_ids=list(ids) if ids is not None else None,
                ),
            )
            return [
                (r.id, r.name, r.maintainer, r.enable_api, context.active_workspace_id, workspace_name)
                for r in result.data
            ], result.has_more
        dataset_page = self._datasets.list_datasets(
            context,
            DatasetListFilter(
                page=page,
                limit=100,
                keyword=keyword,
                for_selection=True,
                ids=tuple(ids) if ids is not None else (),
            ),
        )
        return [
            (r["id"], r["name"], r["maintainer"], r["enable_api"], context.active_workspace_id, workspace_name)
            for r in dataset_page["data"]
        ], dataset_page["has_more"]

    @staticmethod
    def _resource_views(
        kind: str, values: Sequence[tuple[str, str, str | None, bool, str, str]]
    ) -> list[PersonalAccessTokenResourceView]:
        return [
            PersonalAccessTokenResourceView(
                resource_type=kind,
                resource_id=resource_id,
                workspace_id=workspace_id,
                display_name=name,
                workspace_name=workspace_name,
                available=True,
                reason=None,
                maintainer=maintainer,
                api_enabled=api_enabled,
                display_name_snapshot=name,
                workspace_name_snapshot=workspace_name,
            )
            for resource_id, name, maintainer, api_enabled, workspace_id, workspace_name in values
        ]

    def workspace_candidates(
        self,
        context: AccountRequestContext,
        *,
        keyword: str | None,
        cursor: int,
        limit: int,
    ) -> PersonalAccessTokenWorkspacePage:
        candidates = self._tokens.workspace_candidates(
            context.account_id,
            keyword=keyword,
            offset=cursor,
            limit=limit + 1,
        )
        return PersonalAccessTokenWorkspacePage(
            candidates[:limit],
            cursor + limit if len(candidates) > limit else None,
        )

    def _validate_app_runner_resources(
        self,
        account_id: str,
        scopes: PersonalAccessTokenScopes,
        *,
        existing: frozenset[tuple[str, str]],
    ) -> tuple[PersonalAccessTokenResourceView, ...]:
        added = frozenset((r.resource_type, r.resource_id) for r in scopes.resources) - existing
        if not added:
            return ()
        runner_refs = {ref for ref in added if ref[0] == "app_runner"}
        if not runner_refs:
            return ()
        selected = {
            (resource.resource_type, resource.resource_id): resource
            for resource in self._deployments.snapshot(account_id).resources
            if (resource.resource_type, resource.resource_id) in runner_refs
        }
        if selected.keys() != runner_refs:
            raise PersonalAccessTokenAccessDeniedError("Selected resource is unavailable.")
        return tuple(selected[ref] for ref in sorted(runner_refs))

    @staticmethod
    def _validate_scopes(scopes: PersonalAccessTokenScopes) -> None:
        if scopes.resource_mode == scopes.workspace_mode == "none":
            raise ValueError("At least one scope must be enabled.")
        if scopes.resource_mode == "selected" and not scopes.resources:
            raise ValueError("Select at least one resource.")
        if scopes.workspace_mode == "selected" and not scopes.workspace_ids:
            raise ValueError("Select at least one workspace.")
        if scopes.resource_mode != "selected" and scopes.resources:
            raise ValueError("Resource selections require Selected mode.")
        if scopes.workspace_mode != "selected" and scopes.workspace_ids:
            raise ValueError("Workspace selections require Selected mode.")
