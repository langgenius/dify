from typing import Optional

from extensions.ext_database import db
from models.model import EndUser, App


def create_or_update_end_user_for_user_id(app_model: App, user_id: Optional[str] = None) -> EndUser:
    """
    Create or update session terminal based on user ID.
    """
    if not user_id:
        user_id = 'DEFAULT-USER'

    end_user = db.session.query(EndUser) \
        .filter(
        EndUser.tenant_id == app_model.tenant_id,
        EndUser.session_id == user_id,
        EndUser.type == 'service_api'
    ).first()

    if end_user is None:
        end_user = EndUser(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            type='service_api',
            is_anonymous=True if user_id == 'DEFAULT-USER' else False,
            session_id=user_id
        )
        db.session.add(end_user)
        db.session.commit()

    return end_user
