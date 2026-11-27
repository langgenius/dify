from configs.feature.hosted_service import HostedCreditConfig


def test_credit_rates_follow_the_current_price_table_without_changing_legacy_matches() -> None:
    prices = HostedCreditConfig(HOSTED_MODEL_CREDIT_CONFIG="free:0,paid:2,paid:5,paid :9,bad:n/a")

    assert [prices.get_model_credits(name) for name in ("free", "paid", "bad", "unknown")] == [0, 5, 1, 1]

    prices.HOSTED_MODEL_CREDIT_CONFIG = "free:3,paid:0"
    assert [prices.get_model_credits(name) for name in ("free", "paid")] == [3, 0]
