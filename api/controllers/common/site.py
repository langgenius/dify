from configs import dify_config
from enums.deployment_edition import DeploymentEdition
from extensions.ext_database import db
from extensions.storage.storage_type import StorageType
from libs.helper import build_icon_url
from models.model import IconType, Site
from services.file_service import FileService


def build_site_icon_url(*, site: Site, tenant_id: str) -> str | None:
    """Build the public URL for a site's icon in the active deployment mode."""
    if site.icon_type != IconType.IMAGE or not site.icon:
        return None
    if dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and (
        StorageType(dify_config.STORAGE_TYPE) == StorageType.S3
    ):
        return FileService(db.engine).get_file_presigned_url(file_id=site.icon, tenant_id=tenant_id)
    return build_icon_url(site.icon_type, site.icon)
