"""Materialized Console execution responses shared by SQL and LogStore results."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, TenantAccountJoin
from models.enums import CreatorUserRole
from models.model import EndUser
from models.workflow import WorkflowNodeExecutionModel


class WorkflowNodeExecutionRepository:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    def execution_record(self, execution: WorkflowNodeExecutionModel, *, include_details: bool) -> dict[str, Any]:
        """Materialize Console response data, including creators stored outside the execution backend.

        Execution/offload rows are already detached by the execution repository.
        Plugin extras belong to the runtime adapter and are resolved after this read.
        """
        raw = {key: value for key, value in vars(execution).items() if key in execution.__table__.columns}
        if not include_details:
            if "offload_data" in vars(execution):
                raw["offload_data"] = [
                    {
                        "id": offload.id,
                        "tenant_id": offload.tenant_id,
                        "app_id": offload.app_id,
                        "node_execution_id": offload.node_execution_id,
                        "type_": offload.type_.value,
                        "file_id": offload.file_id,
                        "created_at": offload.created_at,
                    }
                    for offload in execution.offload_data
                ]
            return raw
        with self._sessions() as session:
            account = (
                session.scalar(
                    select(Account)
                    .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                    .where(Account.id == execution.created_by, TenantAccountJoin.tenant_id == execution.tenant_id)
                )
                if execution.created_by_role == CreatorUserRole.ACCOUNT
                else None
            )
            end_user = (
                session.scalar(
                    select(EndUser).where(
                        EndUser.id == execution.created_by,
                        EndUser.tenant_id == execution.tenant_id,
                        EndUser.app_id == execution.app_id,
                    )
                )
                if execution.created_by_role == CreatorUserRole.END_USER
                else None
            )
            return {
                **raw,
                "inputs_dict": execution.inputs_dict,
                "process_data_dict": execution.process_data_dict,
                "outputs_dict": execution.outputs_dict,
                "execution_metadata_dict": execution.execution_metadata_dict,
                "inputs_truncated": execution.inputs_truncated,
                "outputs_truncated": execution.outputs_truncated,
                "process_data_truncated": execution.process_data_truncated,
                "created_by_account": {"id": account.id, "name": account.name, "email": account.email}
                if account is not None
                else None,
                "created_by_end_user": {
                    "id": end_user.id,
                    "type": end_user.type,
                    "is_anonymous": end_user.is_anonymous,
                    "session_id": end_user.session_id,
                }
                if end_user is not None
                else None,
            }
