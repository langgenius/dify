import builtins
from unittest.mock import patch

from flask.views import MethodView as FlaskMethodView

_NEEDS_METHOD_VIEW_CLEANUP = False
if not hasattr(builtins, "MethodView"):
    builtins.MethodView = FlaskMethodView
    _NEEDS_METHOD_VIEW_CLEANUP = True
from controllers.common.fields import Parameters, Site
from core.app.app_config.common.parameters_mapping import get_parameters_from_feature_dict
from models.model import IconType
from models.model import Site as SiteModel


def test_parameters_model_round_trip():
    parameters = get_parameters_from_feature_dict(features_dict={}, user_input_form=[])

    model = Parameters.model_validate(parameters)

    assert model.model_dump(mode="json") == parameters


def test_site_icon_url_uses_signed_url_for_image_icon():
    site = Site(
        title="Example",
        icon_type=IconType.IMAGE,
        icon="file-id",
        default_language="en-US",
        show_workflow_steps=True,
        chat_color_theme_inverted=False,
        use_icon_as_answer_icon=False,
    )

    with patch("controllers.common.fields.file_helpers.get_signed_file_url", return_value="signed") as mock_helper:
        model = Site.model_validate(site)

        assert model.icon_url == "signed"
        mock_helper.assert_called_once_with("file-id")


def test_site_icon_url_is_none_for_non_image_icon():
    site = Site(
        title="Example",
        icon_type=IconType.EMOJI,
        icon="file-id",
        default_language="en-US",
        show_workflow_steps=True,
        chat_color_theme_inverted=False,
        use_icon_as_answer_icon=False,
    )

    with patch("controllers.common.fields.file_helpers.get_signed_file_url") as mock_helper:
        model = Site.model_validate(site)

        assert model.icon_url is None
        mock_helper.assert_not_called()
