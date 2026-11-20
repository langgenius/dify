# Backend Feature Flags

Name flags for what the caller can do. Keep edition defaults and applicable
overrides in the feature service so callers can use the effective capability.

## Fixing a lint error

Replace the edition import or check with an existing named capability. If none
fits, add one in [FeatureService] for product capabilities and workspace
entitlements, or in [SystemFeatureService] for deployment-wide system policies
such as registration. For example, use `FeatureService.is_agent_preview_enabled()`
to decide whether to allow an Agent App preview run.

Backend callers can use these methods directly. If a change also needs to add a
field to the public System Features response, follow the [Public System Features contract].

[FeatureService]: ../api/services/feature_service.py
[Public System Features contract]: ../api/controllers/API_SCHEMA_GUIDE.md#public-system-features-contract
[SystemFeatureService]: ../api/services/system_feature_service.py
