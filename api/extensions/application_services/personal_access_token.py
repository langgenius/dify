"""Compose personal-account PAT lifecycle services."""

from flask import request
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums import DeploymentEdition
from libs.token import extract_console_cookie_token, extract_csrf_token, extract_csrf_token_from_cookie
from repositories.personal_access_token_repository import PersonalAccessTokenRepository
from services.app.console_service import ConsoleAppService
from services.knowledge.datasets.application import DatasetApplicationService
from services.personal_access_token_cipher import AESPersonalAccessTokenCipher
from services.personal_access_token_deployments import ConsolePersonalAccessTokenDeploymentCatalog
from services.personal_access_token_service import PersonalAccessTokenService


def build_personal_access_token_service(
    *, database_client: sessionmaker[Session], apps: ConsoleAppService, datasets: DatasetApplicationService
) -> PersonalAccessTokenService:
    tokens = PersonalAccessTokenRepository(session_factory=database_client)
    return PersonalAccessTokenService(
        tokens=tokens,
        deployments=ConsolePersonalAccessTokenDeploymentCatalog(
            context=tokens,
            headers=_console_headers,
            enabled=lambda: dify_config.DEPLOYMENT_EDITION == DeploymentEdition.ENTERPRISE,
        ),
        cipher=AESPersonalAccessTokenCipher(key=lambda: dify_config.PAT_ENCRYPTION_KEY),
        apps=apps,
        datasets=datasets,
    )


def _console_headers() -> dict[str, str]:
    token = extract_console_cookie_token(request)
    return {
        "Authorization": f"Bearer {token}" if token else "",
        "X-CSRF-Token": extract_csrf_token(request) or extract_csrf_token_from_cookie(request) or "",
    }
