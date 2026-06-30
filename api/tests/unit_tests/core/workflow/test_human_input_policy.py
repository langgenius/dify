import pytest

from core.workflow.human_input import SelectInputConfig, StringListSource, ValueSourceType
from core.workflow.human_input_policy import (
    HumanInputSurface,
    get_preferred_form_token,
    is_recipient_type_allowed_for_surface,
    resolve_variable_select_input_options,
)
from graphon.runtime import VariablePool
from models.human_input import RecipientType


# Token surfaces (SERVICE_API, OPENAPI) may act only on public web-app forms;
# CONSOLE may act on internal console/backstage forms. OPENAPI mirrors SERVICE_API
# today but is pinned independently because the two are expected to diverge.
@pytest.mark.parametrize(
    ("recipient_type", "surface", "allowed"),
    [
        (RecipientType.STANDALONE_WEB_APP, HumanInputSurface.SERVICE_API, True),
        (RecipientType.CONSOLE, HumanInputSurface.SERVICE_API, False),
        (RecipientType.BACKSTAGE, HumanInputSurface.SERVICE_API, False),
        (RecipientType.EMAIL_MEMBER, HumanInputSurface.SERVICE_API, False),
        (RecipientType.STANDALONE_WEB_APP, HumanInputSurface.OPENAPI, True),
        (RecipientType.CONSOLE, HumanInputSurface.OPENAPI, False),
        (RecipientType.BACKSTAGE, HumanInputSurface.OPENAPI, False),
        (RecipientType.CONSOLE, HumanInputSurface.CONSOLE, True),
        (RecipientType.BACKSTAGE, HumanInputSurface.CONSOLE, True),
        (RecipientType.STANDALONE_WEB_APP, HumanInputSurface.CONSOLE, False),
    ],
)
def test_recipient_type_allowed_per_surface(
    recipient_type: RecipientType, surface: HumanInputSurface, allowed: bool
) -> None:
    assert is_recipient_type_allowed_for_surface(recipient_type, surface) is allowed


def test_preferred_form_token_uses_shared_priority_order() -> None:
    recipients = [
        (RecipientType.STANDALONE_WEB_APP, "web-token"),
        (RecipientType.CONSOLE, "console-token"),
        (RecipientType.BACKSTAGE, "backstage-token"),
    ]

    assert get_preferred_form_token(recipients) == "backstage-token"


def test_preferred_form_token_skips_prioritized_type_with_empty_token() -> None:
    # An empty token is not actionable: the highest-priority recipient that
    # actually carries a token wins, not the highest-priority type.
    recipients = [
        (RecipientType.BACKSTAGE, ""),
        (RecipientType.CONSOLE, "console-token"),
    ]

    assert get_preferred_form_token(recipients) == "console-token"


def test_resolve_variable_select_input_options_uses_runtime_values() -> None:
    variable_pool = VariablePool()
    variable_pool.add(("start", "options"), ["approve", "reject"])
    inputs: list[SelectInputConfig] = [
        SelectInputConfig(
            output_variable_name="decision",
            option_source=StringListSource(
                type=ValueSourceType.VARIABLE,
                selector=["start", "options"],
                value=[],
            ),
        )
    ]

    resolved = resolve_variable_select_input_options(inputs, variable_pool=variable_pool)
    assert isinstance(resolved[0], SelectInputConfig)
    assert resolved[0].option_source.value == ["approve", "reject"]


def test_resolve_variable_select_input_options_keeps_original_when_value_not_string_list() -> None:
    variable_pool = VariablePool()
    variable_pool.add(("start", "options"), [1, 2, 3])
    inputs = [
        SelectInputConfig(
            output_variable_name="decision",
            option_source=StringListSource(
                type=ValueSourceType.VARIABLE,
                selector=["start", "options"],
                value=[],
            ),
        )
    ]

    with pytest.raises(TypeError):
        resolve_variable_select_input_options(inputs, variable_pool=variable_pool)
