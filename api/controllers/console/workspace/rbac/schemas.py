"""HTTP payloads, pagination aliases and response schemas for workspace RBAC."""

from typing import Any, Literal

from flask import request
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from services.rbac import contracts as dto


class _RBACRoleList(dto.Paginated[dto.RBACRole]):
    pass


class _AccessPolicyList(dto.Paginated[dto.AccessPolicy]):
    pass


class _MembersInRoleList(dto.Paginated[dto.MembersInRole]):
    pass


register_response_schema_models(
    console_ns,
    dto.PermissionCatalogResponse,
    dto.RBACRole,
    _RBACRoleList,
    _MembersInRoleList,
    dto.AccessPolicy,
    _AccessPolicyList,
    dto.AccessPolicyBindingState,
    dto.MyPermissionsResponse,
    dto.AppAccessMatrix,
    dto.DatasetAccessMatrix,
    dto.AgentAccessMatrix,
    dto.WorkspaceAccessMatrix,
    dto.ResourceWhitelist,
    dto.ResourceWhitelistConfig,
    dto.ResourceUserAccessPoliciesResponse,
    dto.ReplaceUserAccessPoliciesResponse,
    dto.RoleBindingsResponse,
    dto.MemberBindingsResponse,
    dto.MemberRolesResponse,
    dto.AccessMatrixItem,
)


class _PaginationQuery(BaseModel):
    model_config = ConfigDict(extra="ignore")

    page_number: int | None = Field(default=None, ge=1, validation_alias=AliasChoices("page", "page_number"))
    results_per_page: int | None = Field(
        default=None, ge=1, le=99999, validation_alias=AliasChoices("limit", "results_per_page")
    )
    reverse: bool | None = None

    def to_inner_options(self) -> dto.ListOption:
        return dto.ListOption.model_validate(self.model_dump())


class _RolesListQuery(_PaginationQuery):
    include_owner: int = Field(default=0, ge=0, le=1)


class CopyRoleParam(BaseModel):
    copy_member: bool = True


class _RoleUpsertRequest(BaseModel):
    """Accepts the payload sent by the Create/Edit Role dialog."""

    name: str
    description: str = ""
    permission_keys: list[str] = []

    def to_mutation(self) -> dto.RoleMutation:
        return dto.RoleMutation(
            name=self.name,
            description=self.description,
            permission_keys=list(self.permission_keys),
        )


class _AccessPolicyCreateRequest(BaseModel):
    name: str
    resource_type: dto.RBACResourceType
    description: str = ""
    permission_keys: list[str] = []


class _AccessPolicyUpdateRequest(BaseModel):
    name: str
    description: str = ""
    permission_keys: list[str] = []


register_schema_models(console_ns, _AccessPolicyCreateRequest, _AccessPolicyUpdateRequest)


class _ResourceAccessScopeRequest(BaseModel):
    automatic_include_workspace_members: bool


class _ReplaceBindingsRequest(BaseModel):
    role_ids: list[str] = Field(default_factory=list)
    account_ids: list[str] = Field(default_factory=list)

    @field_validator("role_ids", "account_ids", mode="before")
    @classmethod
    def _coerce_bindings(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class _DeleteMemberBindingsRequest(BaseModel):
    account_ids: list[str] = Field(default_factory=list)

    @field_validator("account_ids", mode="before")
    @classmethod
    def _coerce_account_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


class _AccessControlLanguageQuery(BaseModel):
    language: Literal["en", "ja", "zh"] | None = Field(default=None, description="Localized policy label language")


class _ResourceUserAccessPoliciesQuery(_PaginationQuery):
    language: Literal["en", "ja", "zh"] | None = Field(default=None, description="Localized policy label language")


register_schema_models(
    console_ns,
    _ResourceAccessScopeRequest,
    _ReplaceBindingsRequest,
    _DeleteMemberBindingsRequest,
    _AccessControlLanguageQuery,
    _ResourceUserAccessPoliciesQuery,
    dto.ReplaceUserAccessPolicies,
)


class _ReplaceMemberRolesRequest(BaseModel):
    role_ids: list[str] = []

    @field_validator("role_ids", mode="before")
    @classmethod
    def _coerce_role_ids(cls, value: Any) -> list[str]:
        if value is None:
            return []
        return value


register_schema_models(console_ns, _ReplaceMemberRolesRequest)


def pagination_options() -> dto.ListOption:
    return _PaginationQuery.model_validate(request.args.to_dict(flat=True)).to_inner_options()
