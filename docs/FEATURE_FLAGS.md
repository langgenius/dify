# Feature Flags

Application code checks named capabilities instead of inferring them from
`CLOUD`, `ENTERPRISE`, or `COMMUNITY`. Deployment editions provide combinations
of feature defaults; they are not the contract used by business code or UI components.

## Designing capability checks

- Name the behavior being controlled, such as tenant-scoped email configuration,
  branding, or SSO. Do not replace edition comparisons with generic `is_cloud`,
  `is_saas`, or `is_enterprise` wrappers.
- Configure capabilities independently. Adding another combination of features
  should not require new edition branches throughout the application.
- Resolve configuration, edition defaults, and workspace overrides in the
  policy owner. Callers use the resulting capability.
- Frontend flags control presentation. Routes and backend operations still enforce
  the capability and the caller's authorization when accessed directly.

## Policy ownership and exposure

Use `SystemFeatureService` for deployment-wide policies, `FeatureService` for
workspace capabilities, and the existing domain owner for domain-specific features.
Web components use named feature policies or narrow capability atoms.

A deployment-wide policy does not automatically belong in the public
`/system-features` response. That response is an unauthenticated bootstrap contract,
not a general registry of configuration, permissions, quotas, or internal policies.
New public fields must satisfy the existing [Public System Features contract].
Evaluate Console and WebApp login/bootstrap needs separately; a shared DTO is not
a reason to expose a field to an unrelated surface.

After authentication, capabilities belong in the owning authenticated response or
bootstrap query. Avoid an endpoint per flag. If the Console shell aggregates
`access` and `capabilities` in one response, keep those fields separate: user
permissions and deployment availability are different concerns. Capabilities for a page
and resource permission overrides stay with their page or resource API.
Frequently changing workspace data should not enter a long-lived global snapshot.
Web bootstrap and cache ownership are described in [Web bootstrap ownership].

## Fixing a lint error

1. Identify the capability the caller actually needs and reuse its existing policy.
2. If it is missing, add a policy for that capability in the matching owner listed
   below. Keep raw edition resolution there; do not add an edition wrapper to the caller.
3. Replace the raw comparison or import with the policy result or capability atom.
   Expose a new frontend value through its appropriate contract only when needed.
4. Test the enabled and disabled behavior, then rerun the relevant lint check.
   Do not hide a new edition check with a suppression or a larger baseline count.

For example, backend callers use `FeatureService.use_tenant_scoped_email_config()`
instead of checking for Cloud. Web callers use a capability such as
`isAgentV2Enabled()` instead of deriving availability from an edition identifier.
Reading edition metadata for display or logging does not itself constitute a
feature decision, but new raw imports outside the policy modules are still rejected.

## Policy modules

Only these exact modules may add raw edition dependencies and decisions. A filename
containing `feature` or `flag` does not grant an exemption.

### Backend

- `api/services/feature_service.py`
- `api/services/system_feature_service.py`
- `api/services/knowledge_fs/feature_service.py`

### Web

- `web/features/system-features/state.ts` for derived capability atoms.
- `web/features/agent-v2/feature-flag.ts`
- `web/features/agent-v2/agent-detail/configure/feature-flags.ts`
- `web/features/contacts/management/feature-flag.ts`
- `web/features/contacts/im-platform/feature-flag.ts`

## Lint scope

| Checker                                      | Source scope                                                                                                  | Entry points                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `scripts/check_no_new_deployment_edition.py` | `.py` and `.pyi` files under `api/`, including tests                                                          | `make lint`, Python Style CI, or the script directly                  |
| `dify/no-new-deployment-edition`             | JS/TS files under `web/`, including tests, with the existing generated/vendor and declaration-file exclusions | Oxlint through `vp check`, `vp lint`, staged checks, and TS Common CI |

The scopes do not overlap. The Web rule implements the ESLint-compatible plugin
API and runs through Oxlint; ESLint's non-code pass does not enable it again.
The backend ast-grep rule only selects Python candidates for its guard.

The backend guard rejects enum imports, qualified enum access, comparisons
(including membership), and `match` cases. The Web rule rejects generated
`DeploymentEdition` type imports, raw `deploymentEditionAtom` imports, comparisons,
membership calls, and `switch` cases. These are syntactic checks for known imports,
conventional edition names, and direct aliases; they do not perform interprocedural
analysis or resolve shadowed names.

## Git baselines

Existing occurrences retain their baseline. Normalized syntax and per-module
occurrence counts allow formatting, import alias changes, and Git-detected file
renames. Copies and changed decisions fail. A move out of a policy module does not
carry its exemption. Editing a `match` or `switch` body does not add a case; newly
introduced edition decisions inside it are still checked.

Run local checks from the repository root. Both checkers use the merge base with
`upstream/main`, `origin/main`, or `main`, falling back to `HEAD` when none exists.

- Backend: run `uv run --project api python scripts/check_no_new_deployment_edition.py`.
  Use `--staged` to compare the index with `HEAD`, or `--base-rev <commit>` for committed revisions.
- Web: use `vp check <paths>` or `vp lint <paths>`. Set
  `DIFY_EDITION_GUARD_BASE_REV` to select a different available target commit.

CI compares with the tested target revision and fetches its history. The resolved
Web baseline SHA is part of the static-check task cache key. If baseline lookup
fails, fetch the target branch and rerun, or explicitly select an available commit
using the option above. A baseline lookup failure must not silently disable the rule.

## Sources

This guide summarizes the [Feature flags guideline] and [System Features guideline].
Public API admission and Web bootstrap details remain with their linked owners.

[Feature flags guideline]: https://langgenius.feishu.cn/wiki/NjjBwpZMmiCGzckTisOcfKt3nyd
[Public System Features contract]: ../api/controllers/API_SCHEMA_GUIDE.md#public-system-features-contract
[System Features guideline]: https://langgenius.feishu.cn/wiki/QfGswPNiHiOrDhk1GlecmUESnod
[Web bootstrap ownership]: ../web/features/system-features/README.md
