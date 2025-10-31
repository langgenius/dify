from collections.abc import Mapping

from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from models.model import App, DefaultEndUserSessionID, EndUser


class EndUserService:
    """
    Service for managing end users.
    """

    @classmethod
    def get_or_create_end_user(cls, app_model: App, user_id: str | None = None) -> EndUser:
        """
        Get or create an end user for a given app.
        """

        return cls.get_or_create_end_user_by_type(InvokeFrom.SERVICE_API, app_model.tenant_id, app_model.id, user_id)

    @classmethod
    def get_or_create_end_user_by_type(
        cls, type: InvokeFrom, tenant_id: str, app_id: str, user_id: str | None = None
    ) -> EndUser:
        """
        Get or create an end user for a given app and type.
        """

        if not user_id:
            user_id = DefaultEndUserSessionID.DEFAULT_SESSION_ID

        with Session(db.engine, expire_on_commit=False) as session:
            end_user = (
                session.query(EndUser)
                .where(
                    EndUser.tenant_id == tenant_id,
                    EndUser.app_id == app_id,
                    EndUser.session_id == user_id,
                    EndUser.type == type,
                )
                .first()
            )

            if end_user is None:
                end_user = EndUser(
                    tenant_id=tenant_id,
                    app_id=app_id,
                    type=type,
                    is_anonymous=user_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID,
                    session_id=user_id,
                    external_user_id=user_id,
                )
                session.add(end_user)
                session.commit()

        return end_user

    @classmethod
    def create_end_user_batch(
        cls, type: InvokeFrom, tenant_id: str, app_ids: list[str], user_id: str
    ) -> Mapping[str, EndUser]:
        """Create end users in batch.

        Creates end users in batch for the specified tenant and application IDs in O(1) time.

        This batch creation is necessary because trigger subscriptions can span multiple applications,
        and trigger events may be dispatched to multiple applications simultaneously.

        For each app_id in app_ids, check if an `EndUser` with the given
        `user_id` (as session_id/external_user_id) already exists for the
        tenant/app and type `type`. If it exists, return it; otherwise,
        create it. Operates with minimal DB I/O by querying and inserting in
        batches.

        Returns a mapping of `app_id -> EndUser`.
        """

        # Normalize user_id to default if empty
        if not user_id:
            user_id = DefaultEndUserSessionID.DEFAULT_SESSION_ID

        # Deduplicate app_ids while preserving input order
        seen: set[str] = set()
        unique_app_ids: list[str] = []
        for app_id in app_ids:
            if app_id not in seen:
                seen.add(app_id)
                unique_app_ids.append(app_id)

        # Result is a simple app_id -> EndUser mapping
        result: dict[str, EndUser] = {}
        if not unique_app_ids:
            return result

        with Session(db.engine, expire_on_commit=False) as session:
            # Fetch existing end users for all target apps in a single query
            existing_end_users: list[EndUser] = (
                session.query(EndUser)
                .where(
                    EndUser.tenant_id == tenant_id,
                    EndUser.app_id.in_(unique_app_ids),
                    EndUser.session_id == user_id,
                    EndUser.type == type,
                )
                .all()
            )

            found_app_ids: set[str] = set()
            for eu in existing_end_users:
                # If duplicates exist due to weak DB constraints, prefer the first
                if eu.app_id not in result:
                    result[eu.app_id] = eu
                found_app_ids.add(eu.app_id)

            # Determine which apps still need an EndUser created
            missing_app_ids = [app_id for app_id in unique_app_ids if app_id not in found_app_ids]

            if missing_app_ids:
                new_end_users: list[EndUser] = []
                is_anonymous = user_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID
                for app_id in missing_app_ids:
                    new_end_users.append(
                        EndUser(
                            tenant_id=tenant_id,
                            app_id=app_id,
                            type=type,
                            is_anonymous=is_anonymous,
                            session_id=user_id,
                            external_user_id=user_id,
                        )
                    )

                session.add_all(new_end_users)
                session.commit()

                for eu in new_end_users:
                    result[eu.app_id] = eu

        return result
