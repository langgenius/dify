# Cucumber Best Practices

Use this reference when writing or reviewing Gherkin scenarios, step definitions, parameter expressions, and step reuse.

Official sources:

- https://cucumber.io/docs/bdd/better-gherkin
- https://cucumber.io/docs/gherkin/reference
- https://cucumber.io/docs/gherkin/step-organization
- https://cucumber.io/docs/cucumber/state
- https://cucumber.io/docs/cucumber/cucumber-expressions
- https://github.com/cucumber/cucumber-js/blob/main/docs/support_files/world.md

## What Matters Most

### 1. Treat scenarios as executable specifications

Cucumber scenarios should usually describe behavior declaratively, not reproduce an interaction script.

Apply it like this:

- write what the user does and what should happen
- avoid UI-internal wording such as selector details, DOM structure, or component names
- keep language concrete enough that the scenario reads like living documentation

Procedural detail is appropriate when the interaction mechanism is the behavior under test, such as keyboard navigation, focus movement, or a required multi-actor sequence.

### 2. Keep scenarios focused

A scenario should prove one business rule or coherent outcome. Cucumber's three-to-five-step recommendation is a review heuristic, not a hard limit: when a scenario is longer, check for multiple outcomes, incidental setup, or UI procedure that can move behind a domain step.

Use `Given` for initial context, `When` for the event, and `Then` for the expected outcome. Restarting those phases is a prompt to review the narrative, not an automatic failure. Avoid hidden dependencies on another scenario's side effects.

Use `Rule` when several examples illustrate one named business rule. Use a short `Background` only for shared context the reader needs to understand; do not hide fixture preparation, runtime readiness, or long setup there.

### 3. Reuse steps, but only when behavior really matches

Good reuse reduces duplication. Bad reuse hides meaning.

Prefer reuse when:

- the user action is genuinely the same
- the expected outcome is genuinely the same
- the wording stays natural across features
- the parameter is a real product domain value such as a named surface, mode, resource, or status

Write a new step when:

- the behavior is materially different
- reusing the old wording would make the scenario misleading
- a supposedly generic step would become an implementation-detail wrapper

Do not optimize for a low step count by making vague steps. Optimize for a small set of truthful, domain-owned steps.

Step definitions share one global matching namespace regardless of their directory. Organize them by domain capability and avoid feature-coupled glue or expressions broad enough to overlap unrelated behavior.

### 4. Prefer Cucumber Expressions

Use Cucumber Expressions for parameters unless regex is clearly necessary.

Common examples:

- `{string}` for labels, names, and visible text
- `{int}` for counts
- `{float}` for decimal values
- `{word}` only when the value is truly a single token

Keep expressions readable. If a step needs complicated parsing logic, first ask whether the scenario wording should be simpler.

Use regex for a bounded natural-language alternative only when it keeps Gherkin readable, for example `/(Web app|Backend service API)/`. Avoid broad regexes that accept unowned language.

### 5. Keep step definitions thin and meaningful

Step definitions are glue between Gherkin and automation, not a second abstraction language. A step should express one coherent domain action or outcome; it may call several implementation helpers when that keeps UI mechanics out of the specification.

Cucumber creates a new World for each scenario. Keep scenario state there rather than in module globals. Cucumber.js supports a `world` proxy for arrow functions, but this suite consistently uses typed `async function (this: DifyWorld, ...)` so ownership and TypeScript discovery remain explicit.

Hooks are invisible to feature readers. Keep them for low-level browser lifecycle, cleanup, and diagnostics; express business-relevant context in Gherkin.

### 6. Use tags intentionally

Tags may communicate stable capability grouping, selection, fixture dependency, or conditional-hook intent. A tag changes runtime behavior only when a runner, seed profile, or hook owns that meaning.

## Review Questions

- Does the scenario read like a real example of product behavior?
- Does it prove one outcome, or combine several independent phases?
- Are the steps behavior-oriented instead of implementation-oriented?
- Is procedural wording necessary to the behavior being tested?
- Is a reused step still truthful in this feature?
- Could a new expression overlap an existing step in the global namespace?
- Would `Rule` clarify the business rule, or would `Background` hide important setup?
- Is a new tag documenting real behavior, or inventing semantics that the suite does not implement?
- Would a new reader understand the outcome without opening the step-definition file?
