# Code Quality Review

Use this pack for changed type, styling, or copy contracts. Scope and reporting thresholds come
from the skill entrypoint; do not turn general style preferences into findings.

## Types And Boundaries

[Ownership] defines module boundaries, extraction, props, and domain types; [Data] owns generated
API types. For Dify UI public exports and upstream-derived props, use [Public API authoring].

- Identify the actual type information lost by a widened field, DTO mirror, or assertion. Trace
  consumers before proposing a new abstraction or adapter.
- Check that moved imports still use the intended public boundary. Distinguish an application
  bypassing that boundary from the implementation that owns a library integration.
- Require a real migration or compatibility need for new aliases and forwarding layers. Check
  whether an existing owner can express the behavior with less state or indirection.

## Styling And Copy

- Use [Styling] for tokens, class composition, state callbacks, and focus ownership, and [Overlays]
  for portal/layering changes. Report the violated contract or rendered failure, not the absence
  of a preferred utility class.
- Apply [Web requirements] to localized strings and supported locales. Keep keys in the owning
  feature namespace; aliases are for crossing namespaces. Verify changed keys and interpolation
  against their consumers rather than reviewing only the English text.
- Check whether action and recovery copy explains the real next step. A generic label or wording
  preference alone is not a defect; establish ambiguity or an applicable naming contract.

[Data]: ../../how-to-write-component/references/data.md
[Overlays]: ../../../../packages/dify-ui/docs/overlays.md
[Ownership]: ../../how-to-write-component/references/ownership.md
[Public API authoring]: ../../../../packages/dify-ui/docs/authoring.md
[Styling]: ../../../../packages/dify-ui/docs/styling.md
[Web requirements]: ../../../../web/AGENTS.md
