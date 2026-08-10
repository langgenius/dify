## 1. Resolved Form Domain Model

- [x] 1.1 Add unit tests for immutable `MarkdownText`, `ParagraphInput`, `SelectInput`, `FileInput`, `FileListInput`, `ResolvedFormAction`, and `ResolvedForm` values, including tuple ownership, resolved-default invariants, channel-neutral exports, and `FileType`/`FileTransferMethod`/`ButtonStyle` enum preservation.
- [x] 1.2 Implement the channel-neutral resolved-form module under `api/core/human_input_v2/` with `Input` and `ResolvedFormContent` unions, upstream-aligned `output_variable_name`, `allowed_file_upload_methods`, and `number_limits` fields, enum-typed `allowed_file_types`, `allowed_file_upload_methods`, and `button_style`, no `required` fields, no `InputBlock` wrapper, and no IM/card semantic names; document that `default_value` is populated only when configured, and place the exact comment `# All non-output variables are resolved; {{#$output.<name>#}} slots remain.` immediately above `ResolvedForm.legacy_form_content`.
- [x] 1.3 Export the common resolved-form values from their domain owner and extend import-boundary tests to prevent dependencies on workflow, IM provider SDKs, controllers, or frontend code.

## 2. Workflow Form Compilation

- [x] 2.1 Add compiler tests for source-order Markdown/input splitting, adjacent input tokens, preservation of non-empty whitespace fragments, missing referenced inputs, and omission of unreferenced inputs.
- [x] 2.2 Add compiler tests proving `legacy_form_content` replaces every non-output variable while preserving `{{#$output.<name>#}}` slots, plus constant and variable-backed paragraph defaults, resolved select options/defaults, frozen file constraints, and effective file-list `number_limits`.
- [x] 2.3 Implement the HITL v2 workflow form compiler under `api/core/workflow/nodes/human_input_v2/`, producing a complete `ResolvedForm` without selectors, value-source discriminators, `Segment` values, or raw mappings.
- [x] 2.4 Update `HumanInputNodeData`-adjacent helpers and tests so form compilation reuses the existing `$output` DSL validation contract instead of adding duplicate-token checks downstream.

## 3. Form Aggregate and Persistence

- [x] 3.1 Update form-domain tests so `HumanInputForm` owns one `resolved_form`, validates selected actions against `resolved_form.user_actions`, and no longer owns parallel `definition` and `rendered_content` values.
- [x] 3.2 Refactor `HumanInputForm`, form projections, and `HumanInputV2FormCreationRequest` to pass the authoritative `ResolvedForm` through creation and delivery boundaries while keeping non-presentation metadata outside it.
- [x] 3.3 Replace the persisted raw form-definition shape with discriminated Markdown/input/action snapshot models, map `ResolvedForm.legacy_form_content` through the existing `rendered_content` physical column, and add round-trip mapper tests for every block variant and `FileType`/`FileTransferMethod` value without introducing SQL DDL.
- [x] 3.4 Update form repository, notification producer, and service fixtures/tests to construct and compare resolved snapshots rather than `FrozenFormDefinition` plus a separate rendered string.

## 4. IM Dynamic Card Contracts and Adapters

- [x] 4.1 Update `IMDynamicCardMessaging` contract tests and exports so `assess` and `send_card` consume `ResolvedForm` directly; remove `NormalizedCardIntent` as a separate runtime wrapper while leaving correlation and static replacement contracts unchanged.
- [x] 4.2 Migrate Slack assessment and serialization to ordered blocks, resolved defaults/options, provider-specific limits, and file-input rejection; update Slack adapter and SDK-boundary tests.
- [x] 4.3 Migrate Microsoft Teams assessment and Adaptive Card serialization to ordered blocks and resolved input values; update Teams adapter and SDK-boundary tests, including rejection when source order cannot be preserved.
- [x] 4.4 Migrate Feishu/Lark assessment and dynamic-card serialization to ordered blocks and resolved input values; update shared adapter, branch, and SDK-boundary tests, including provider form-container ordering limitations.
- [x] 4.5 Remove adapter-local raw mapping/default resolution helpers and tests, and verify no dynamic-card adapter parses selectors, value sources, `$output` tokens, a top-level default-values mapping, or `legacy_form_content`; keep static replacement on `StaticCardIntent`.

## 5. Cleanup and Verification

- [x] 5.1 Remove obsolete `FrozenFormDefinition`, `FrozenFormAction`, and `NormalizedCardIntent` imports/exports after all domain and IM consumers use the resolved snapshot.
- [x] 5.2 Run targeted domain, compiler, form service, and repository tests with `make test TARGET_TESTS=./api/tests/unit_tests/<affected-path>` and fix all regressions.
- [x] 5.3 Run the Slack, Microsoft Teams, and Feishu/Lark unit suites, covering ordered rendering, unrepresentable forms, and provider limits.
- [x] 5.4 Run `make lint` and `make type-check`, then verify the change introduces no edits or dependencies under `web/` and no changes to HITL v1 delivery behavior.
