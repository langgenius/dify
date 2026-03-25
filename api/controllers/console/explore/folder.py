"""Explore sidebar folder CRUD controller.

Routes:
  GET  /explore/folders           – list tenant folders
  POST /explore/folders           – create a folder
  PATCH /explore/folders/<id>     – rename a folder
  DELETE /explore/folders/<id>    – delete an empty folder
  PATCH /installed-apps/<id>/folder – move app into / out of a folder

All routes require login and tenant_id scoping.
"""

import logging

from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models import ExploreAppFolder, InstalledApp

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Payloads
# ---------------------------------------------------------------------------

class FolderCreatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class FolderRenamePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class AppFolderPayload(BaseModel):
    folder_id: str | None = Field(default=None, description="Target folder id; null to remove from any folder")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_folder_or_404(folder_id: str, tenant_id: str) -> ExploreAppFolder:
    folder = db.session.scalars(
        select(ExploreAppFolder).where(
            ExploreAppFolder.id == folder_id,
            ExploreAppFolder.tenant_id == tenant_id,
        )
    ).first()
    if folder is None:
        raise NotFound("Folder not found")
    return folder


# ---------------------------------------------------------------------------
# List / Create folders
# ---------------------------------------------------------------------------

@console_ns.route("/explore/folders")
class ExploreFolderListApi(Resource):
    """CRUD collection endpoint for explore sidebar folders."""

    @login_required
    @account_initialization_required
    def get(self):
        """Return all folders for the current tenant, ordered by position."""
        _, tenant_id = current_account_with_tenant()
        folders = db.session.scalars(
            select(ExploreAppFolder)
            .where(ExploreAppFolder.tenant_id == tenant_id)
            .order_by(ExploreAppFolder.position)
        ).all()
        return {
            "folders": [
                {"id": f.id, "name": f.name, "position": f.position}
                for f in folders
            ]
        }

    @login_required
    @account_initialization_required
    def post(self):
        """Create a new folder for the current tenant.

        Body: {"name": "<string>"}
        Returns the created folder dict.
        """
        payload = FolderCreatePayload.model_validate(console_ns.payload or {})
        _, tenant_id = current_account_with_tenant()

        # Position = current count (append to end)
        count = db.session.scalar(
            select(func.count()).select_from(ExploreAppFolder).where(ExploreAppFolder.tenant_id == tenant_id)
        ) or 0
        folder = ExploreAppFolder(tenant_id=tenant_id, name=payload.name, position=count)
        db.session.add(folder)
        db.session.commit()
        logger.info("Created explore folder %s for tenant %s", folder.id, tenant_id)
        return {"id": folder.id, "name": folder.name, "position": folder.position}, 201


# ---------------------------------------------------------------------------
# Update / Delete a folder
# ---------------------------------------------------------------------------

@console_ns.route("/explore/folders/<uuid:folder_id>")
class ExploreFolderApi(Resource):
    """Single-folder endpoint: rename or delete."""

    @login_required
    @account_initialization_required
    def patch(self, folder_id):
        """Rename a folder.  Body: {"name": "<string>"}"""
        payload = FolderRenamePayload.model_validate(console_ns.payload or {})
        _, tenant_id = current_account_with_tenant()
        folder = _get_folder_or_404(str(folder_id), tenant_id)
        folder.name = payload.name
        db.session.commit()
        return {"id": folder.id, "name": folder.name, "position": folder.position}

    @login_required
    @account_initialization_required
    def delete(self, folder_id):
        """Delete a folder only when it contains no installed apps.

        Returns 400 if the folder still has apps (client should move them first).
        """
        _, tenant_id = current_account_with_tenant()
        folder = _get_folder_or_404(str(folder_id), tenant_id)

        has_apps = db.session.scalar(
            select(InstalledApp.id).where(InstalledApp.folder_id == str(folder_id)).limit(1)
        ) is not None
        if has_apps:
            raise BadRequest("Cannot delete a non-empty folder")

        db.session.delete(folder)
        db.session.commit()
        return {"result": "success"}, 204


# ---------------------------------------------------------------------------
# Move installed app into / out of a folder
# ---------------------------------------------------------------------------

@console_ns.route("/installed-apps/<uuid:installed_app_id>/folder")
class InstalledAppFolderApi(Resource):
    """Assign an installed app to a folder, or remove it from any folder."""

    @login_required
    @account_initialization_required
    def patch(self, installed_app_id):
        """Move app into a folder (or out if folder_id is null).

        Body: {"folder_id": "<uuid>" | null}
        Validates that the target folder belongs to the same tenant.
        """
        payload = AppFolderPayload.model_validate(console_ns.payload or {})
        _, tenant_id = current_account_with_tenant()

        installed_app = db.session.scalars(
            select(InstalledApp).where(
                InstalledApp.id == str(installed_app_id),
                InstalledApp.tenant_id == tenant_id,
            )
        ).first()
        if installed_app is None:
            raise NotFound("Installed app not found")

        if payload.folder_id is not None:
            # Verify the target folder exists and belongs to this tenant
            _get_folder_or_404(payload.folder_id, tenant_id)

        installed_app.folder_id = payload.folder_id
        db.session.commit()
        return {"result": "success", "folder_id": installed_app.folder_id}

