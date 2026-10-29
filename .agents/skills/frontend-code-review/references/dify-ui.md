# Dify UI Review Routing

Use this reference for changes to `packages/dify-ui/` or its application consumers. Review the
contract owned by the changed layer: upstream behavior, Dify primitive integration, or feature
composition.

## Find The Owner

- Package changes follow [Package rules]; Web consumers follow [Web rules]. Keep their respective
  package boundaries and application requirements in scope.
- If the affected contract is known, read its owner guide directly. Use the [Package index] only
  to discover available primitives, public subpaths, or the matching guide; do not load every guide.
- Trace implementation, public types, tests, and stories as needed to decide a candidate. If they
  disagree with documentation, establish which contract applies before reporting a violation.
- For upstream-derived behavior, check the installed API and current official [Base UI docs].
  Do not assume the latest upstream example matches the installed version or Dify wrapper.

## Check The Changed Boundary

- Does a wrapper preserve the public types, value relationships, events, and anatomy its consumers
  rely on? Follow the package's public API authoring contract when that surface changes.
- Does `render` composition forward the required props and ref, preserve event handling, and read
  state from the owning part? Use the styling and upstream composition contracts to check callback
  merging; do not introduce parallel React state merely to reproduce primitive state styles.
- Does the change preserve the documented owner of focus, positioning, portals, and dismissal?
  Check shared fixes at that owner and feature-specific composition at the consumer. Consult the
  overlay contract for presence and the form/control contract for labels, values, and validation.
- For custom primitive integrations, trace the upstream APIs they actually use and verify the
  resulting public behavior. A thin passthrough and a Dify-authored Field/Form integration have
  different responsibilities; test those responsibilities without duplicating upstream coverage.

Report an observable defect or an applicable explicit contract violation. Do not turn a preferred
composition, a newer upstream example, or a missing call-site style into a finding on its own.

[Base UI docs]: https://base-ui.com/react
[Package index]: ../../../../packages/dify-ui/README.md
[Package rules]: ../../../../packages/dify-ui/AGENTS.md
[Web rules]: ../../../../web/AGENTS.md
