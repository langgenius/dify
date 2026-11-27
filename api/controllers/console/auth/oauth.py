import secrets
import urllib.parse

from flask import redirect, request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import UnprocessableEntity
from werkzeug.wrappers import Response

from configs import dify_config
from constants.languages import languages
from controllers.common.fields import RedirectResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.auth.login_mode import require_login_mode
from controllers.console.error import AccountInFreezeError, EmailDomainSuspendedError
from controllers.console.wraps import model_validate, setup_required, social_oauth_login_enabled
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, extract_remote_ip
from libs.helper import timezone as validate_timezone_string
from libs.oauth import (
    ACCOUNT_OAUTH_STATE_MAX_AGE,
    ACCOUNT_OAUTH_STATE_PREFIX,
    AccountOAuthState,
    OAuthState,
    decode_account_oauth_state,
    decode_oauth_state,
    encode_account_oauth_state,
)
from libs.token import (
    is_secure,
    set_access_token_to_cookie,
    set_csrf_token_to_cookie,
    set_refresh_token_to_cookie,
    set_webapp_access_token_to_cookie,
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
from services.entities.account_login_entities import LoginMode
from services.entities.account_oauth_entities import (
    OAuthAuthorizationRequest,
    OAuthCallbackCommand,
    OAuthCallbackResult,
    OAuthInvitationResult,
)
from services.web_login_handoff import S256_CHALLENGE_PATTERN
from services.web_login_redirect import (
    resolve_console_login_redirect,
    resolve_personal_login_redirect,
    resolve_web_portal_login_redirect,
)


class OAuthLoginQuery(BaseModel):
    mode: LoginMode = Field(
        default=LoginMode.CONSOLE, description="End User mode skips workspace admission and provisioning"
    )
    invite_token: str | None = Field(default=None, description="Optional invitation token")
    timezone: str | None = Field(default=None, description="Preferred timezone")
    language: str | None = Field(default=None, description="Preferred interface language")
    redirect_url: str | None = Field(
        default=None,
        description="Console page to resume after login; End User mode accepts personal portal URLs, "
        "defaults to /my-apps and can resume /signin to complete a PKCE handoff",
    )
    code_challenge: str | None = Field(
        default=None,
        pattern=S256_CHALLENGE_PATTERN,
        description="Web-origin S256 challenge for an End User personal portal return; omit for /signin resume URLs.",
    )


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


def _console_callback_target(result: OAuthCallbackResult, requested_redirect: str | None) -> str:
    """Return to the Console after successful OAuth or continue a workspace invitation."""
    if isinstance(result, OAuthInvitationResult):
        query = urllib.parse.urlencode({"invite_token": result.invite_token})
        return f"{dify_config.CONSOLE_WEB_URL.rstrip('/')}/signin/invite-settings?{query}"

    target_url = _safe_console_redirect_target(requested_redirect)
    parsed = urllib.parse.urlsplit(target_url)
    query = f"{parsed.query}&" if parsed.query else ""
    query += f"oauth_new_user={str(result.oauth_new_user).lower()}"
    return urllib.parse.urlunsplit(parsed._replace(query=query))


def _personal_portal_redirect(redirect_url: str | None) -> str | None:
    """Return a validated personal portal destination, or None for invalid input."""
    return resolve_personal_login_redirect(
        redirect_url, app_web_url=dify_config.APP_WEB_URL, console_web_url=dify_config.CONSOLE_WEB_URL
    )


def _portal_pkce_signin_target(redirect_url: str | None, code_challenge: str) -> str:
    """Bind a portal target and its S256 challenge to the ordinary Console sign-in resume flow.

    Reject non-WebApp destinations before starting OAuth. Only the challenge travels
    through the provider's signed state; the verifier stays in the initiating Web tab.
    """
    webapp_url = dify_config.APP_WEB_URL or dify_config.CONSOLE_WEB_URL
    target = resolve_web_portal_login_redirect(redirect_url, webapp_url=webapp_url)
    if target is None:
        raise UnprocessableEntity("Invalid personal portal login target.")
    portal = urllib.parse.urlsplit(target)
    route = portal.path.removeprefix(urllib.parse.urlsplit(webapp_url).path.rstrip("/"))
    params = urllib.parse.urlencode(
        {
            "is_end_user": "1",
            "redirect_url": urllib.parse.urlunsplit(("", "", route, portal.query, portal.fragment)),
            "code_challenge": code_challenge,
        }
    )
    return f"{dify_config.CONSOLE_WEB_URL.rstrip('/')}/signin?{params}"


def _end_user_signin_target(redirect_url: str) -> str | None:
    """Allow the Console sign-in route to resume an App or portal handoff after OAuth."""
    target = resolve_console_login_redirect(redirect_url, console_web_url=dify_config.CONSOLE_WEB_URL)
    if target is not None:
        console_path = urllib.parse.urlsplit(dify_config.CONSOLE_WEB_URL).path.rstrip("/")
        if urllib.parse.urlsplit(target).path == f"{console_path}/signin":
            return target
    return None


def _end_user_return_target(redirect_url: str | None) -> str:
    """Resume on Console sign-in or return to the WebApp portal; never bypass App PKCE."""
    if redirect_url and (resume := _end_user_signin_target(redirect_url)) is not None:
        return resume
    return _personal_portal_redirect(redirect_url) or _personal_portal_redirect(None) or "/my-apps"


def _oauth_state_cookie(provider: str, nonce: str) -> str:
    return f"account_oauth_{provider}_{nonce}"


def _safe_console_redirect_target(redirect_url: str | None) -> str:
    """Resolve an untrusted Console target, defaulting to the configured Console home."""
    target = (
        resolve_console_login_redirect(redirect_url, console_web_url=dify_config.CONSOLE_WEB_URL)
        if redirect_url
        else None
    )
    return target or dify_config.CONSOLE_WEB_URL or "/"


def _signin_redirect(message: str, **params: str) -> Response:
    query = urllib.parse.urlencode({"message": message, **params})
    return redirect(f"{dify_config.CONSOLE_WEB_URL.rstrip('/')}/signin?{query}")


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
        """Start provider login with a browser-bound return target; reject ambiguous PKCE context."""
        require_login_mode(req_data.mode, invite_token=req_data.invite_token)
        redirect_url = req_data.redirect_url or None
        if req_data.code_challenge is not None:
            if req_data.mode != LoginMode.END_USER:
                raise UnprocessableEntity("A portal login challenge requires End User mode.")
            redirect_url = _portal_pkce_signin_target(redirect_url, req_data.code_challenge)
        elif req_data.mode == LoginMode.END_USER:
            redirect_url = _end_user_return_target(redirect_url)
        nonce = secrets.token_urlsafe(32)
        context: OAuthState = {}
        if redirect_url:
            context["redirect_url"] = redirect_url
        if req_data.invite_token:
            context["invite_token"] = req_data.invite_token
        if timezone := _validated_timezone(req_data.timezone):
            context["timezone"] = timezone
        if language := _validated_language(req_data.language):
            context["language"] = language
        state = encode_account_oauth_state(
            AccountOAuthState(mode=req_data.mode, provider=provider, nonce=nonce, context=context)
        )
        try:
            auth_url = application_services().accounts.oauth.start_authorization(
                provider,
                OAuthAuthorizationRequest(
                    invite_token=req_data.invite_token or None,
                    timezone=_validated_timezone(req_data.timezone),
                    language=_validated_language(req_data.language),
                    redirect_url=redirect_url,
                    mode=req_data.mode,
                    state=state,
                ),
            )
        except InvalidOAuthProviderError:
            return dump_response(OAuthErrorResponse, {"error": "Invalid provider"}), 400
        response = redirect(auth_url)
        response.headers["Cache-Control"] = "no-store"
        response.set_cookie(
            _oauth_state_cookie(provider, nonce),
            nonce,
            httponly=True,
            secure=is_secure(),
            samesite="Lax",
            max_age=ACCOUNT_OAUTH_STATE_MAX_AGE,
        )
        return response


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
        mode = LoginMode.CONSOLE
        state_cookie = None
        if (req_data.state or "").startswith(ACCOUNT_OAUTH_STATE_PREFIX):
            state = decode_account_oauth_state(req_data.state or "")
            state_cookie = _oauth_state_cookie(provider, state.nonce)
            nonce = request.cookies.get(state_cookie)
            if state.provider != provider or not nonce or not secrets.compare_digest(state.nonce, nonce):
                raise ValueError("OAuth state does not match this browser.")
            mode = LoginMode(state.mode)
            oauth_state = state.context
        else:
            # Do not downgrade an active protected attempt to the legacy Console flow.
            if any(name.startswith(f"account_oauth_{provider}_") for name in request.cookies):
                raise ValueError("Missing or invalid OAuth state.")
            oauth_state = decode_oauth_state(req_data.state)
        require_login_mode(mode, invite_token=oauth_state.get("invite_token"))
        requested_redirect = oauth_state.get("redirect_url")
        end_user_target = _end_user_return_target(requested_redirect) if mode == LoginMode.END_USER else None

        def signin_redirect(message: str, **params: str) -> Response:
            """Keep retry navigation on Console sign-in, preserving validated return context."""
            if end_user_target is not None:
                if (resume := _end_user_signin_target(end_user_target)) is not None:
                    target = urllib.parse.urlsplit(resume)
                    query = f"{target.query}&" if target.query else ""
                    query += urllib.parse.urlencode({"message": message})
                    response = redirect(urllib.parse.urlunsplit(target._replace(query=query)))
                else:
                    response = _signin_redirect(message, is_end_user="1", redirect_url=end_user_target)
            else:
                if requested_redirect:
                    params["redirect_url"] = _safe_console_redirect_target(requested_redirect)
                response = _signin_redirect(message, **params)
            if state_cookie is not None:
                response.delete_cookie(state_cookie)
            return response

        try:
            result = application_services().accounts.oauth.complete_authorization(
                OAuthCallbackCommand(
                    provider=provider,
                    code=req_data.code,
                    mode=mode,
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
            return signin_redirect(exc.description)
        except InvalidOAuthInvitationError:
            return signin_redirect("Invalid invitation token.")
        except OAuthInvitationAccountMismatchError as exc:
            return signin_redirect(
                "This invitation was sent to another account. Please sign in with the invited account.",
                invite_token=exc.invite_token,
            )
        except OAuthAccountBannedError:
            return signin_redirect("Account is banned.")
        except OAuthAccountNotFoundError:
            return signin_redirect("Account not found.")
        except OAuthWorkspaceCreationNotAllowedError:
            return signin_redirect(
                "Workspace not found, please contact system admin to invite you to join in a workspace."
            )
        except OAuthSeatsLimitExceededError:
            return signin_redirect("Licensed seats limit exceeded.")
        except AccountEmailDomainSuspendedError:
            return signin_redirect(EmailDomainSuspendedError.description or "")
        except AccountEmailFrozenError:
            return signin_redirect(AccountInFreezeError.description or "")
        except OAuthRegistrationError as exc:
            return signin_redirect(exc.description)

        target_url = end_user_target or _console_callback_target(result, requested_redirect)
        response = _redirect_with_console_session(result.tokens, target_url)
        if end_user_target is not None and _personal_portal_redirect(end_user_target) is not None:
            session = application_services().web_login_handoff.personal_session(result.tokens.access_token)
            set_webapp_access_token_to_cookie(request, response, session.access_token, expires_at=session.expires_at)
        if state_cookie is not None:
            response.delete_cookie(state_cookie)
        return response
