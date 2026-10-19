"""Translate personal PAT policies to the existing Account admission pipeline."""

import uuid

from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, Unauthorized

from constants.oauth_bearer import TokenType
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.loaders import load_app, load_workspace, route_has_app
from controllers.openapi.auth.requirements import Rank, Requirement
from controllers.openapi.auth.subjects import Subject
from extensions.ext_application_services import application_services
from libs.oauth_bearer import AuthContext, sha256_hex
from libs.rate_limit import enforce_bearer_rate_limit
from services.personal_access_token_service import (
    PersonalAccessTokenAccessDeniedError,
    PersonalAccessTokenInvalidError,
    PersonalAccessTokenNotFoundError,
)


def authenticate_personal_token(secret: str) -> AuthContext:
    enforce_bearer_rate_limit(sha256_hex(secret))
    try:
        record = application_services().personal_access_tokens.authenticate(secret)
    except PersonalAccessTokenInvalidError:
        raise Unauthorized("invalid bearer") from None
    return AuthContext(
        token_type=TokenType.PERSONAL_ACCESS,
        account_id=uuid.UUID(record.account_id),
        token_id=uuid.UUID(record.summary.id),
        expires_at=record.summary.expires_at,
        subject_email=None,
        subject_issuer=None,
        client_id=None,
    )


class CheckPersonalAccess(Requirement):
    rank = Rank.EARLY

    def __init__(self, policy: PersonalAccessTokenPolicy) -> None:
        self._policy = policy

    def run(self, subject: Subject, ctx: Context, session: Session) -> None:
        app_id = None
        workspace_id = None
        if self._policy not in {
            PersonalAccessTokenPolicy.WORKSPACE_DISCOVERY,
            PersonalAccessTokenPolicy.IDENTITY_DISCOVERY,
        }:
            if route_has_app(ctx):
                app = load_app(ctx)
                app_id = app.id
                workspace_id = app.tenant_id
            else:
                workspace_id = load_workspace(ctx).id
        try:
            grant = application_services().personal_access_tokens.authorize(
                account_id=str(subject.account_id),
                token_id=str(subject.token_id),
                policy=self._policy,
                workspace_id=workspace_id,
                app_id=app_id,
            )
        except (PersonalAccessTokenInvalidError, PersonalAccessTokenNotFoundError):
            raise Unauthorized("invalid bearer") from None
        except PersonalAccessTokenAccessDeniedError as error:
            raise Forbidden(str(error)) from None
        ctx.personal_workspace_ids = grant.workspace_ids
        ctx.personal_app_ids = grant.app_ids
