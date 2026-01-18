import logging

from flask import redirect, request
from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import current_account_with_tenant, login_required
from services.github.github_oauth_service import GitHubOAuthService

logger = logging.getLogger(__name__)


@console_ns.route("/github/oauth/authorize")
class GitHubOAuthAuthorize(Resource):
    @login_required
    @account_initialization_required
    @setup_required
    @console_ns.doc("github_oauth_authorize")
    def get(self):
        """Initiate GitHub OAuth flow."""
        account, tenant = current_account_with_tenant()

        app_id = request.args.get("app_id")
        redirect_uri = request.args.get("redirect_uri")

        try:
            auth_url, _state = GitHubOAuthService.get_authorization_url(
                tenant_id=tenant,
                user_id=account.id,
                app_id=app_id,
                redirect_uri=redirect_uri,
            )
            return redirect(auth_url, code=302)
        except ValueError as e:
            logger.exception("GitHub OAuth authorization failed")
            raise BadRequest(str(e)) from e
        except Exception as e:
            logger.exception("Unexpected error in GitHub OAuth authorization")
            raise BadRequest(f"Failed to initiate OAuth flow: {str(e)}") from e


@console_ns.route("/github/oauth/callback")
class GitHubOAuthCallback(Resource):
    @setup_required
    @console_ns.doc("github_oauth_callback")
    def get(self):
        """Handle GitHub OAuth callback."""
        code = request.args.get("code")
        state = request.args.get("state")
        error = request.args.get("error")

        if error:
            error_description = request.args.get("error_description", error)
            logger.error("GitHub OAuth error: %s - %s", error, error_description)
            from configs import dify_config

            redirect_url = f"{dify_config.CONSOLE_WEB_URL}?github_oauth_error={error_description}"
            return redirect(redirect_url, code=302)

        if not code or not state:
            from configs import dify_config

            redirect_url = f"{dify_config.CONSOLE_WEB_URL}?github_oauth_error=Missing code or state parameter"
            return redirect(redirect_url, code=302)

        try:
            oauth_result = GitHubOAuthService.handle_callback(code=code, state=state)
            # Redirect to frontend workflow editor with OAuth state
            # The frontend will use this state to retrieve the token and create connection when repository is selected
            from configs import dify_config

            # Redirect to workflow editor with OAuth state (not connection_id)
            if oauth_result.app_id:
                redirect_url = (
                    f"{dify_config.CONSOLE_WEB_URL}/app/{oauth_result.app_id}/workflow"
                    f"?github_oauth_state={oauth_result.oauth_state}"
                )
            else:
                redirect_url = f"{dify_config.CONSOLE_WEB_URL}?github_oauth_state={oauth_result.oauth_state}"
            return redirect(redirect_url, code=302)
        except ValueError as e:
            logger.exception("GitHub OAuth callback failed")
            import urllib.parse

            from configs import dify_config

            error_msg = urllib.parse.quote(str(e))
            redirect_url = f"{dify_config.CONSOLE_WEB_URL}?github_oauth_error={error_msg}"
            return redirect(redirect_url, code=302)
        except Exception as e:
            logger.exception("Unexpected error in GitHub OAuth callback", exc_info=True)
            import urllib.parse

            from configs import dify_config

            error_msg = urllib.parse.quote(f"Failed to complete OAuth flow: {str(e)}")
            redirect_url = f"{dify_config.CONSOLE_WEB_URL}?github_oauth_error={error_msg}"
            return redirect(redirect_url, code=302)
