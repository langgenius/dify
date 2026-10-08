"""Adapt manual debug inputs to the common tenant-aware file factory."""

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import FileAccessControllerProtocol
from factories.workflow_input import map_user_inputs_to_variable_pool
from graphon.runtime import VariablePool


class HumanInputDebugFileGateway:
    def __init__(self, *, sessions: sessionmaker[Session], access: FileAccessControllerProtocol) -> None:
        self._sessions = sessions
        self._access = access

    def map_inputs(
        self,
        *,
        tenant_id: str,
        variable_mapping: Mapping[str, Sequence[str]],
        user_inputs: dict[str, Any],
        variable_pool: VariablePool,
    ) -> None:
        map_user_inputs_to_variable_pool(
            variable_mapping=variable_mapping,
            user_inputs=user_inputs,
            variable_pool=variable_pool,
            tenant_id=tenant_id,
            access_controller=self._access,
            sessions=self._sessions,
        )
