from controllers.openapi.auth.composition import account_pipeline, auth_router, external_sso_pipeline
from controllers.openapi.auth.flow import When
from controllers.openapi.auth.pipeline import AuthPipeline, PipelineRoute, PipelineRouter
from libs.oauth_bearer import TokenType


def test_account_pipeline_is_auth_pipeline():
    assert isinstance(account_pipeline, AuthPipeline)


def test_external_sso_pipeline_is_auth_pipeline():
    assert isinstance(external_sso_pipeline, AuthPipeline)


def test_auth_router_is_pipeline_router():
    assert isinstance(auth_router, PipelineRouter)


def test_account_pipeline_prepare_has_six_entries():
    assert len(account_pipeline._prepare) == 6


def test_account_auth_list_has_seven_entries():
    assert len(account_pipeline._auth) == 7


def test_external_sso_pipeline_prepare_has_four_entries():
    assert len(external_sso_pipeline._prepare) == 4


def test_external_sso_auth_list_has_four_entries():
    assert len(external_sso_pipeline._auth) == 4


def test_account_pipeline_has_unconditional_load_account():
    non_when = [s for s in account_pipeline._prepare if not isinstance(s, When)]
    assert len(non_when) == 1


def test_external_sso_pipeline_all_prepare_entries_are_when():
    assert all(isinstance(s, When) for s in external_sso_pipeline._prepare)


def test_account_pipeline_has_one_unconditional_auth_step():
    non_when = [s for s in account_pipeline._auth if not isinstance(s, When)]
    assert len(non_when) == 1


def test_external_sso_pipeline_has_one_unconditional_auth_step():
    non_when = [s for s in external_sso_pipeline._auth if not isinstance(s, When)]
    assert len(non_when) == 1


def test_router_routes_contain_both_token_types():
    assert TokenType.OAUTH_ACCOUNT in auth_router._routes
    assert TokenType.OAUTH_EXTERNAL_SSO in auth_router._routes


def test_external_sso_route_has_ee_required_edition():
    route = auth_router._routes[TokenType.OAUTH_EXTERNAL_SSO]
    assert isinstance(route, PipelineRoute)
    from controllers.openapi.auth.data import Edition

    assert route.required_edition == frozenset({Edition.EE})


def test_account_route_has_no_required_edition():
    route = auth_router._routes[TokenType.OAUTH_ACCOUNT]
    assert isinstance(route, PipelineRoute)
    assert route.required_edition is None
