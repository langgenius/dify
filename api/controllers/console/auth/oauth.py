import urllib.parse

from flask import redirect, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.wrappers import Response

from configs import dify_config
from constants.languages import languages
from controllers.common.fields import RedirectResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console.error import AccountInFreezeError, EmailDomainSuspendedError
from controllers.console.wraps import model_validate, setup_required, social_oauth_login_enabled
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, extract_remote_ip
from libs.helper import timezone as validate_timezone_string
from libs.oauth import decode_oauth_state
from libs.token import (
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
)
from services.account_errors import (
    AccountEmailDomainSuspendedError,
    AccountEmailFrozenError,
    InvalidOAuthInvitationError,
    InvalidOAuthProviderError,
    OAuthAccountBannedError,
    OAuthAccountNotFoundError,
    OAuthIdentityLockUnavailableError,
    OAuthInvitationAccountMismatchError,
    OAuthProviderAuthorizationError,
    OAuthProviderRequestError,
    OAuthRegistrationError,
    OAuthSeatsLimitExceededError,
    OAuthWorkspaceCreationNotAllowedError,
)
from services.entities.account_entities import AccountSessionTokens
from services.entities.account_oauth_entities import (
    OAuthAuthorizationRequest,
    OAuthCallbackCommand,
    OAuthCallbackResult,
    OAuthInvitationResult,
)

from .. import console_ns


class OAuthLoginQuery(BaseModel):
    invite_token: str | None = Field(default=None, description="Optional invitation token")
    timezone: str | None = Field(default=None, description="Preferred timezone")
    language: str | None = Field(default=None, description="Preferred interface language")
    redirect_url: str | None = Field(default=None, description="Relative page to resume after login")


class OAuthCallbackQuery(BaseModel):
    code: str = Field(description="Authorization code from OAuth provider")
    state: str | None = Field(default=None, description="OAuth state parameter")


class OAuthErrorResponse(ResponseModel):
    error: str = Field(description="OAuth error message")


register_schema_models(console_ns, OAuthLoginQuery, OAuthCallbackQuery)
register_response_schema_models(console_ns, RedirectResponse, OAuthErrorResponse)


def _validated_timezone(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return validate_timezone_string(value)
    except ValueError:
        return None


def _validated_language(value: str | None) -> str | None:
    if value and value in languages:
        return value
    return None


def _preferred_interface_language() -> str | None:
    preferred_lang = request.accept_languages.best_match(languages)
    if preferred_lang and preferred_lang in languages:
        return preferred_lang
    return None


def _redirect_with_console_session(tokens: AccountSessionTokens, target_url: str) -> Response:
    """Attach application-issued Console session cookies to a redirect response."""
    response = redirect(target_url)
    set_access_token_to_cookie(request, response, tokens.access_token)
    set_refresh_token_to_cookie(request, response, tokens.refresh_token)
    set_csrf_token_to_cookie(request, response, tokens.csrf_token)
    return response


def _oauth_callback_target(result: OAuthCallbackResult, requested_redirect: str | None) -> str:
    if isinstance(result, OAuthInvitationResult):
        query = urllib.parse.urlencode({"invite_token": result.invite_token})
        return f"{dify_config.CONSOLE_WEB_URL}/signin/invite-settings?{query}"

    target_url = _safe_console_redirect_target(requested_redirect)
    query_char = "&" if "?" in target_url else "?"
    return f"{target_url}{query_char}oauth_new_user={str(result.oauth_new_user).lower()}"


def _safe_console_redirect_target(redirect_url: str | None) -> str:
    if not redirect_url:
        return dify_config.CONSOLE_WEB_URL

    parsed_url = urllib.parse.urlsplit(redirect_url)
    normalized_path = redirect_url.lstrip().replace("\\", "/")
    if not parsed_url.scheme and not parsed_url.netloc and not normalized_path.startswith("//"):
        return redirect_url

    redirect_origin = _url_origin(redirect_url)
    if redirect_origin is not None and redirect_origin == _url_origin(dify_config.CONSOLE_WEB_URL):
        return redirect_url
    return dify_config.CONSOLE_WEB_URL


def _url_origin(url: str) -> tuple[str, str, int] | None:
    parsed_url = urllib.parse.urlsplit(url)
    if parsed_url.scheme not in {"http", "https"} or parsed_url.hostname is None:
        return None
    try:
        port = parsed_url.port
    except ValueError:
        return None
    if port is None:
        port = 443 if parsed_url.scheme == "https" else 80
    return parsed_url.scheme, parsed_url.hostname, port


def _signin_redirect(message: str, **params: str) -> Response:
    query = urllib.parse.urlencode({"message": message, **params})
    return redirect(f"{dify_config.CONSOLE_WEB_URL}/signin?{query}")


@console_ns.route("/oauth/login/<provider>")
class OAuthLogin(Resource):
    @console_ns.doc("oauth_login")
    @console_ns.doc(description="Initiate OAuth login process")
    @console_ns.doc(params={"provider": "OAuth provider name (github/google)"})
    @console_ns.doc(params=query_params_from_model(OAuthLoginQuery))
    @console_ns.response(302, "Redirect to OAuth authorization URL", console_ns.models[RedirectResponse.__name__])
    @console_ns.response(400, "Invalid provider", console_ns.models[OAuthErrorResponse.__name__])
    @setup_required
    @social_oauth_login_enabled
    @model_validate(OAuthLoginQuery)
    def get(self, req_data: OAuthLoginQuery, provider: str):
        try:
            auth_url = application_services().accounts.oauth.start_authorization(
                provider,
                OAuthAuthorizationRequest(
                    invite_token=req_data.invite_token or None,
                    timezone=_validated_timezone(req_data.timezone),
                    language=_validated_language(req_data.language),
                    redirect_url=req_data.redirect_url or None,
                ),
            )
        except InvalidOAuthProviderError:
            return dump_response(OAuthErrorResponse, {"error": "Invalid provider"}), 400
        return redirect(auth_url)


@console_ns.route("/oauth/authorize/<provider>")
class OAuthCallback(Resource):
    @console_ns.doc("oauth_callback")
    @console_ns.doc(description="Handle OAuth callback and complete login process")
    @console_ns.doc(params={"provider": "OAuth provider name (github/google)"})
    @console_ns.doc(params=query_params_from_model(OAuthCallbackQuery))
    @console_ns.response(302, "Redirect to console with access token", console_ns.models[RedirectResponse.__name__])
    @console_ns.response(400, "OAuth process failed", console_ns.models[OAuthErrorResponse.__name__])
    @setup_required
    @social_oauth_login_enabled
    @model_validate(OAuthCallbackQuery)
    def get(self, req_data: OAuthCallbackQuery, provider: str):
        oauth_state = decode_oauth_state(req_data.state)
        try:
            result = application_services().accounts.oauth.complete_authorization(
                OAuthCallbackCommand(
                    provider=provider,
                    code=req_data.code,
                    invite_token=oauth_state.get("invite_token"),
                    timezone=_validated_timezone(oauth_state.get("timezone")),
                    language=_validated_language(oauth_state.get("language")),
                    browser_language=_preferred_interface_language(),
                    ip_address=extract_remote_ip(request),
                )
            )
        except InvalidOAuthProviderError:
            return dump_response(OAuthErrorResponse, {"error": "Invalid provider"}), 400
        except (OAuthProviderRequestError, OAuthIdentityLockUnavailableError):
            return dump_response(OAuthErrorResponse, {"error": "OAuth process failed"}), 400
        except OAuthProviderAuthorizationError as exc:
            return _signin_redirect(exc.description)
        except InvalidOAuthInvitationError:
            return _signin_redirect("Invalid invitation token.")
        except OAuthInvitationAccountMismatchError as exc:
            return _signin_redirect(
                "This invitation was sent to another account. Please sign in with the invited account.",
                invite_token=exc.invite_token,
            )
        except OAuthAccountBannedError:
            return _signin_redirect("Account is banned.")
        except OAuthAccountNotFoundError:
            return _signin_redirect("Account not found.")
        except OAuthWorkspaceCreationNotAllowedError:
            return _signin_redirect(
                "Workspace not found, please contact system admin to invite you to join in a workspace."
            )
        except OAuthSeatsLimitExceededError:
            return _signin_redirect("Licensed seats limit exceeded.")
        except AccountEmailDomainSuspendedError:
            return _signin_redirect(EmailDomainSuspendedError.description or "")
        except AccountEmailFrozenError:
            return _signin_redirect(AccountInFreezeError.description or "")
        except OAuthRegistrationError as exc:
            return _signin_redirect(exc.description)

        target_url = _oauth_callback_target(result, oauth_state.get("redirect_url"))
        return _redirect_with_console_session(result.tokens, target_url)
