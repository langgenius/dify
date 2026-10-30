import pytest

from dev import generate_billing_client as generator

PREFIX = "#/components/schemas/dify.saas.api.billing."


def _source_spec() -> generator.JsonObject:
    reply = {"$ref": f"{PREFIX}GetSubscriptionInfoReply"}
    return {
        "openapi": "3.0.3",
        "info": {"title": "", "version": "0.0.1"},
        "paths": {
            "/v1/subscription/info": {
                "get": {
                    "operationId": "BillingSubscription_GetSubscriptionInfo",
                    "responses": {"200": {"content": {"application/json": {"schema": reply}}}},
                }
            },
            "/v1/coupons/stripe": {
                "get": {
                    "operationId": "BillingCoupon_ListStripeCoupons",
                    "responses": {
                        "200": {"content": {"application/json": {"schema": {"$ref": f"{PREFIX}ListCouponsReply"}}}}
                    },
                }
            },
        },
        "components": {
            "schemas": {
                "dify.saas.api.billing.GetSubscriptionInfoReply": {
                    "type": "object",
                    "properties": {
                        "plan": {"type": "string", "enum": ["sandbox", "team"]},
                        "paid_period_end": {"type": "string", "format": "int64"},
                        "members": {"$ref": f"{PREFIX}Quota"},
                        "usage_unknown": {"type": "boolean", "nullable": True},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "renewed_at": {"type": "string", "format": "date-time"},
                    },
                },
                "dify.saas.api.billing.Quota": {"type": "object", "properties": {"limit": {"type": "integer"}}},
                "dify.saas.api.billing.ListCouponsReply": {
                    "type": "object",
                    "properties": {"coupon_id": {"type": "string"}},
                },
            }
        },
    }


@pytest.fixture
def subscription_info_only(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(
        generator.ALLOWED_OPERATIONS,
        "billing",
        (generator.AllowedOperation("GET", "/v1/subscription/info", "BILLING"),),
    )


@pytest.mark.usefixtures("subscription_info_only")
def test_snapshot_keeps_only_allowlisted_operations_and_reachable_schemas() -> None:
    snapshot = generator.build_snapshot("billing", _source_spec(), "abc123")

    assert snapshot[generator.SNAPSHOT_COMMIT_KEY] == "abc123"
    assert list(snapshot["paths"]) == ["/v1/subscription/info"]
    assert sorted(snapshot["components"]["schemas"]) == ["GetSubscriptionInfoReply", "Quota"]
    assert "coupon" not in generator.render_snapshot(snapshot).lower()


@pytest.mark.usefixtures("subscription_info_only")
def test_snapshot_marks_presence_from_protojson_rules() -> None:
    schema = generator.build_snapshot("billing", _source_spec(), "abc123")["components"]["schemas"][
        "GetSubscriptionInfoReply"
    ]

    # Proto3 optional fields are omitted when unset, so only they stay out of required.
    assert schema["required"] == ["plan", "paid_period_end", "members", "tags", "renewed_at"]
    assert schema["properties"]["members"] == {"allOf": [{"$ref": "#/components/schemas/Quota"}], "nullable": True}
    assert "nullable" not in schema["properties"]["plan"]


@pytest.mark.usefixtures("subscription_info_only")
def test_rendered_module_types_fields_and_operations() -> None:
    snapshot = generator.build_snapshot("billing", _source_spec(), "abc123")

    source = generator.render_module("billing", snapshot)

    assert 'plan: Literal["sandbox", "team"]' in source
    assert "paid_period_end: int\n" in source
    assert "members: Quota | None\n" in source
    assert "usage_unknown: bool | None = None\n" in source
    assert "renewed_at: datetime\n" in source
    assert "def subscription_get_subscription_info() -> GetSubscriptionInfoReply:" in source
    assert '"/subscription/info",' in source


def test_long_operation_docstring_is_wrapped() -> None:
    allowed = generator.AllowedOperation("GET", f"/v1/subscription/{'x' * 80}", "BILLING")
    operation = {
        "operationId": "BillingSubscription_GetSubscriptionInfo",
        "responses": {"200": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/Reply"}}}}},
    }

    lines = generator.render_operation("billing", allowed, operation)

    assert lines[1] == f'    """GET {allowed.path}\n\n    BillingSubscription_GetSubscriptionInfo\n    """'
    assert all(len(line) <= generator.LINE_LENGTH for line in "\n".join(lines).splitlines())


@pytest.mark.usefixtures("subscription_info_only")
def test_upstream_required_message_field_is_non_null() -> None:
    source = _source_spec()
    source["components"]["schemas"]["dify.saas.api.billing.GetSubscriptionInfoReply"]["required"] = ["members"]

    snapshot = generator.build_snapshot("billing", source, "abc123")
    schema = snapshot["components"]["schemas"]["GetSubscriptionInfoReply"]

    assert schema["properties"]["members"] == {"$ref": "#/components/schemas/Quota"}
    assert schema["required"] == ["plan", "paid_period_end", "members", "tags", "renewed_at"]
    assert "members: Quota\n" in generator.render_module("billing", snapshot)


@pytest.mark.usefixtures("subscription_info_only")
def test_snapshot_rejects_allowlisted_operation_missing_from_spec() -> None:
    source = _source_spec()
    del source["paths"]["/v1/subscription/info"]

    with pytest.raises(generator.GenerationError, match="not in the dify-saas spec"):
        generator.build_snapshot("billing", source, "abc123")


def test_committed_client_matches_snapshots() -> None:
    assert generator.check(generator.expected_files({s: generator.load_snapshot(s) for s in generator.SERVICES})) == 0
