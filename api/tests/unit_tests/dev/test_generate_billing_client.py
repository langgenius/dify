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
                "dify.saas.api.billing.Error": {
                    "required": ["code", "reason", "message", "metadata"],
                    "type": "object",
                    "properties": {
                        "code": {"type": "integer", "description": "HTTP status code.", "format": "int32"},
                        "reason": {"type": "string", "description": "See <Service>ErrorReason."},
                        "message": {"type": "string"},
                        "metadata": {"type": "object", "additionalProperties": {"type": "string"}},
                    },
                },
                "dify.saas.api.billing.BillingSubscriptionErrorReason": {
                    "enum": ["", "CODEC", "MISSING_PLAN"],
                    "type": "string",
                },
                "dify.saas.api.billing.BillingCouponErrorReason": {
                    "enum": ["", "CODEC", "BILLING_COUPON_NOT_FOUND"],
                    "type": "string",
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
    assert sorted(snapshot["components"]["schemas"]) == [
        "BillingSubscriptionErrorReason",
        "Error",
        "GetSubscriptionInfoReply",
        "Quota",
    ]
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
    assert 'type BillingSubscriptionErrorReason = Literal["", "CODEC", "MISSING_PLAN"]' in source
    assert "def _is_billing_subscription_error_reason(value: str) -> TypeIs[BillingSubscriptionErrorReason]:" in source
    assert "errors=BILLING_SUBSCRIPTION_ERRORS," in source
    assert "class BillingSubscriptionUpstreamError(BillingUpstreamError):" in source
    assert "reason: BillingSubscriptionErrorReason | UnknownErrorReason | None = None," in source
    assert (
        "class BillingSubscriptionUpstreamUnavailableError(BillingSubscriptionUpstreamError, "
        "BillingUpstreamUnavailableError):"
    ) in source
    assert "BILLING_SUBSCRIPTION_ERRORS = ServiceErrors(" in source
    assert "Coupon" not in source
    assert "class Error(" not in source
    assert "ErrorReason =" not in source.replace("BillingSubscriptionErrorReason =", "")


def test_rendered_module_gives_each_service_its_own_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(
        generator.ALLOWED_OPERATIONS,
        "billing",
        (
            generator.AllowedOperation("GET", "/v1/subscription/info", "BILLING"),
            generator.AllowedOperation("GET", "/v1/coupons/stripe", "BILLING"),
        ),
    )
    snapshot = generator.build_snapshot("billing", _source_spec(), "abc123")

    source = generator.render_module("billing", snapshot)

    assert {"BillingCouponErrorReason", "BillingSubscriptionErrorReason"} <= set(snapshot["components"]["schemas"])
    subscription, coupon = (
        source.partition(f"def {name}(")[2].partition("\n\n\n")[0]
        for name in ("subscription_get_subscription_info", "coupon_list_stripe_coupons")
    )
    assert "errors=BILLING_SUBSCRIPTION_ERRORS," in subscription
    assert "errors=BILLING_COUPON_ERRORS," in coupon
    assert "class BillingCouponUpstreamError(BillingUpstreamError):" in source


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


@pytest.mark.usefixtures("subscription_info_only")
def test_snapshot_rejects_spec_without_error_schema() -> None:
    source = _source_spec()
    del source["components"]["schemas"]["dify.saas.api.billing.Error"]

    with pytest.raises(generator.GenerationError, match="error schema dify.saas.api.billing.Error "):
        generator.build_snapshot("billing", source, "abc123")


@pytest.mark.usefixtures("subscription_info_only")
def test_snapshot_rejects_operation_without_its_service_reason_schema() -> None:
    source = _source_spec()
    del source["components"]["schemas"]["dify.saas.api.billing.BillingSubscriptionErrorReason"]

    with pytest.raises(
        generator.GenerationError,
        match=r"BillingSubscription_GetSubscriptionInfo\) has no dify.saas.api.billing.BillingSubscriptionErrorReason",
    ):
        generator.build_snapshot("billing", source, "abc123")


@pytest.mark.usefixtures("subscription_info_only")
@pytest.mark.parametrize("operation_id", ["GetSubscriptionInfo", "_GetSubscriptionInfo", "BillingSubscription_", ""])
def test_snapshot_rejects_operation_id_without_service_prefix(operation_id: str) -> None:
    source = _source_spec()
    source["paths"]["/v1/subscription/info"]["get"]["operationId"] = operation_id

    with pytest.raises(generator.GenerationError, match="has no `<Service>_` prefix"):
        generator.build_snapshot("billing", source, "abc123")


@pytest.mark.usefixtures("subscription_info_only")
def test_rendering_rejects_snapshot_whose_reason_schemas_drift_from_its_operations() -> None:
    snapshot = generator.build_snapshot("billing", _source_spec(), "abc123")
    schemas = snapshot["components"]["schemas"]
    schemas["BillingCouponErrorReason"] = {"enum": [""], "type": "string"}

    with pytest.raises(generator.GenerationError, match=r"unused \['BillingCouponErrorReason'\]"):
        generator.render_module("billing", snapshot)

    del schemas["BillingCouponErrorReason"], schemas["BillingSubscriptionErrorReason"]

    with pytest.raises(generator.GenerationError, match=r"missing \['BillingSubscriptionErrorReason'\]"):
        generator.render_module("billing", snapshot)


@pytest.mark.usefixtures("subscription_info_only")
def test_rendering_rejects_error_body_that_drifts_from_the_transport() -> None:
    source = _source_spec()
    source["components"]["schemas"]["dify.saas.api.billing.Error"]["properties"]["details"] = {"type": "string"}
    snapshot = generator.build_snapshot("billing", source, "abc123")

    with pytest.raises(generator.GenerationError, match="update UpstreamErrorBody"):
        generator.render_module("billing", snapshot)


def test_committed_snapshots_keep_only_the_reasons_of_called_services() -> None:
    reason_schemas = {
        service: {
            name: schema["enum"]
            for name, schema in generator.load_snapshot(service)["components"]["schemas"].items()
            if name.endswith("ErrorReason")
        }
        for service in generator.SERVICES
    }

    assert sorted(reason_schemas["billing"]) == [
        "BillingComplianceErrorReason",
        "BillingEducationErrorReason",
        "BillingInvoiceErrorReason",
        "BillingModelProviderErrorReason",
        "BillingQuotaErrorReason",
        "BillingSubscriptionErrorReason",
    ]
    assert sorted(reason_schemas["saas"]) == [
        "AccountErrorReason",
        "SaasNetworkAccessPolicyErrorReason",
        "SaasNotificationErrorReason",
        "UtmErrorReason",
    ]
    education = reason_schemas["billing"]["BillingEducationErrorReason"]
    assert "EDUCATION_VERIFY_FAILED" in education
    assert "COMPLIANCE_DOCUMENT_NOT_FOUND" not in education
    assert "NETWORK_ACCESS_VERSION_CONFLICT" in reason_schemas["saas"]["SaasNetworkAccessPolicyErrorReason"]
    assert "NETWORK_ACCESS_VERSION_CONFLICT" not in reason_schemas["saas"]["AccountErrorReason"]


def test_committed_client_matches_snapshots() -> None:
    assert generator.check(generator.expected_files({s: generator.load_snapshot(s) for s in generator.SERVICES})) == 0
