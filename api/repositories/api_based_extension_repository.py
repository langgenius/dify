"""SQLAlchemy persistence adapter for Console API-based extensions."""

from typing import override

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from models.api_based_extension import APIBasedExtension
from services.api_based_extension_application_service import (
    APIBasedExtensionInput,
    APIBasedExtensionNameConflictError,
    APIBasedExtensionNotFoundError,
    APIBasedExtensionRecord,
    APIBasedExtensionStore,
)


class APIBasedExtensionRepository(APIBasedExtensionStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_extensions(self, workspace_id: str) -> tuple[APIBasedExtensionRecord, ...]:
        with self._session_factory() as session:
            return tuple(
                self._to_record(extension)
                for extension in session.scalars(
                    select(APIBasedExtension)
                    .where(APIBasedExtension.tenant_id == workspace_id)
                    .order_by(APIBasedExtension.created_at.desc(), APIBasedExtension.id.desc())
                ).all()
            )

    @override
    def find_extension(self, workspace_id: str, extension_id: str) -> APIBasedExtensionRecord | None:
        with self._session_factory() as session:
            extension = self._find(session, workspace_id, extension_id)
            return self._to_record(extension) if extension is not None else None

    @override
    def name_exists(self, workspace_id: str, name: str, *, exclude_id: str | None = None) -> bool:
        stmt = select(APIBasedExtension.id).where(
            APIBasedExtension.tenant_id == workspace_id,
            APIBasedExtension.name == name,
        )
        if exclude_id is not None:
            stmt = stmt.where(APIBasedExtension.id != exclude_id)
        with self._session_factory() as session:
            return session.scalar(stmt.limit(1)) is not None

    @override
    def create_extension(self, workspace_id: str, extension: APIBasedExtensionInput) -> APIBasedExtensionRecord:
        try:
            with self._session_factory.begin() as session:
                model = APIBasedExtension(
                    tenant_id=workspace_id,
                    name=extension.name,
                    api_endpoint=extension.api_endpoint,
                    api_key=extension.api_key,
                )
                session.add(model)
                session.flush()
                session.refresh(model)
                return self._to_record(model)
        except IntegrityError as error:
            self._raise_if_name_taken(workspace_id, extension.name, exclude_id=None, error=error)
            raise

    @override
    def update_extension(
        self, workspace_id: str, extension_id: str, extension: APIBasedExtensionInput
    ) -> APIBasedExtensionRecord:
        try:
            with self._session_factory.begin() as session:
                model = self._require(session, workspace_id, extension_id)
                model.name = extension.name
                model.api_endpoint = extension.api_endpoint
                model.api_key = extension.api_key
                session.flush()
                return self._to_record(model)
        except IntegrityError as error:
            self._raise_if_name_taken(workspace_id, extension.name, exclude_id=extension_id, error=error)
            raise

    @override
    def delete_extension(self, workspace_id: str, extension_id: str) -> None:
        with self._session_factory.begin() as session:
            session.delete(self._require(session, workspace_id, extension_id))

    def _raise_if_name_taken(
        self, workspace_id: str, name: str, *, exclude_id: str | None, error: IntegrityError
    ) -> None:
        # A concurrent writer can pass the service's name_exists pre-check and win the (tenant_id, name) unique
        # constraint. Re-check in a fresh transaction so the committed winner is visible under any isolation level;
        # other violations are not name conflicts and must stay visible as failures.
        if self.name_exists(workspace_id, name, exclude_id=exclude_id):
            raise APIBasedExtensionNameConflictError from error

    @staticmethod
    def _find(session: Session, workspace_id: str, extension_id: str) -> APIBasedExtension | None:
        return session.scalar(
            select(APIBasedExtension)
            .where(APIBasedExtension.tenant_id == workspace_id, APIBasedExtension.id == extension_id)
            .limit(1)
        )

    @classmethod
    def _require(cls, session: Session, workspace_id: str, extension_id: str) -> APIBasedExtension:
        extension = cls._find(session, workspace_id, extension_id)
        if extension is None:
            raise APIBasedExtensionNotFoundError
        return extension

    @staticmethod
    def _to_record(extension: APIBasedExtension) -> APIBasedExtensionRecord:
        return APIBasedExtensionRecord(
            id=extension.id,
            name=extension.name,
            api_endpoint=extension.api_endpoint,
            api_key=extension.api_key,
            created_at=extension.created_at,
        )
