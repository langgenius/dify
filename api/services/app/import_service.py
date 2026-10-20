"""DSL import use cases shared by account and delegated enterprise callers."""

from typing import Protocol

from machinery.context import RequestContext
from services.entities.account_entities import AccountSnapshot
from services.entities.dsl_entities import AppImportParams, CheckDependenciesResult, Import


class ImportAccounts(Protocol):
    def find_by_email(self, email: str) -> AccountSnapshot | None: ...


class AppDefinitionImports(Protocol):
    def import_dsl(self, context: RequestContext, params: AppImportParams) -> Import: ...

    def confirm_definition(self, context: RequestContext, import_id: str) -> Import: ...

    def check_dependencies(self, context: RequestContext, app_id: str) -> CheckDependenciesResult: ...


class AppImportService:
    def __init__(self, *, accounts: ImportAccounts, definitions: AppDefinitionImports) -> None:
        self._accounts = accounts
        self._definitions = definitions

    def import_app(self, context: RequestContext, params: AppImportParams) -> Import:
        return self._definitions.import_dsl(context, params)

    def import_as_creator(
        self,
        *,
        workspace_id: str,
        creator_email: str,
        params: AppImportParams,
        request_id: str,
        trace_id: str | None,
    ) -> Import | None:
        account = self._accounts.find_by_email(creator_email)
        if account is None or account.status != "active" or account.email != creator_email:
            return None
        context = RequestContext(request_id, trace_id, account.id, workspace_id)
        return self.import_app(context, params)

    def confirm_import(self, context: RequestContext, import_id: str) -> Import:
        return self._definitions.confirm_definition(context, import_id)

    def check_dependencies(self, context: RequestContext, app_id: str) -> CheckDependenciesResult:
        return self._definitions.check_dependencies(context, app_id)
