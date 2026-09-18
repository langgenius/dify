"""The one-shot app-name refine flag survives the commit round-trip."""

from core.dify_builder.models import DifyBuilderContext
from services.dify_builder.serde import context_from_dict, context_to_dict


def test_app_name_auto_defaults_off():
    # Off by default: an app is only renamed when its creator asked for it.
    assert DifyBuilderContext().app_name_auto is False


def test_app_name_auto_round_trips():
    fc = DifyBuilderContext(app_name_auto=True)
    assert context_from_dict(context_to_dict(fc)).app_name_auto is True


def test_app_name_auto_absent_in_an_older_row_defaults_off():
    # Sessions started before this field must not suddenly rename their apps.
    assert context_from_dict({"goal_text": "x"}).app_name_auto is False
