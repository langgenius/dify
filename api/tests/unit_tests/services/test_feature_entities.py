import pytest
from pydantic import ValidationError

from enums import CloudPlan
from services.entities.feature_entities import LicenseLimitationModel, SubscriptionModel


def test_subscription_model_uses_the_cloud_plan_value_set() -> None:
    subscription = SubscriptionModel(plan="team")

    assert subscription.plan is CloudPlan.TEAM

    with pytest.raises(ValidationError):
        SubscriptionModel(plan="unknown")


@pytest.mark.parametrize(
    ("enabled", "size", "limit", "required", "expected"),
    [
        (False, 5, 10, 3, True),
        (False, 5, 10, 10, True),
        (True, 5, 0, 3, True),
        (True, 5, 0, 100, True),
        (True, 5, 10, 3, True),
        (True, 5, 10, 5, True),
        (True, 5, 10, 1, True),
        (True, 8, 10, 3, False),
        (True, 8, 10, 2, True),
        (True, 8, 10, 1, True),
        (True, 7, 10, 3, True),
    ],
)
def test_license_limitation_availability(
    enabled: bool,
    size: int,
    limit: int,
    required: int,
    expected: bool,
) -> None:
    limitation = LicenseLimitationModel(enabled=enabled, size=size, limit=limit)

    assert limitation.is_available(required) is expected
