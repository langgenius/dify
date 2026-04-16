from controllers.console.app.site import AppSiteResponse


def test_app_site_response_allows_missing_code():
    response = AppSiteResponse.model_validate(
        {
            "app_id": "app-1",
            "code": None,
            "title": "Public Site",
            "default_language": "en-US",
            "customize_token_strategy": None,
            "prompt_public": True,
            "show_workflow_steps": False,
            "use_icon_as_answer_icon": True,
        }
    )

    assert response.code is None
    assert response.access_token is None


def test_app_site_response_maps_code_to_access_token():
    response = AppSiteResponse.model_validate(
        {
            "app_id": "app-1",
            "code": "site-code",
            "title": "Public Site",
            "default_language": "en-US",
            "customize_token_strategy": "allow",
            "prompt_public": True,
            "show_workflow_steps": False,
            "use_icon_as_answer_icon": True,
        }
    )

    assert response.code == "site-code"
    assert response.access_token == "site-code"
