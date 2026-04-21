# Cucumber Best Practices For Dify E2E

Use this reference when writing or reviewing Gherkin scenarios, step definitions, parameter expressions, and step reuse in Dify's `e2e/` suite.

Official sources:

- https://cucumber.io/docs/guides/10-minute-tutorial/
- https://cucumber.io/docs/cucumber/step-definitions/
- https://cucumber.io/docs/cucumber/cucumber-expressions/

## What Matters Most

### 1. Treat scenarios as executable specifications

Cucumber scenarios should describe examples of behavior, not test implementation recipes.

Apply it like this:

- write what the user does and what should happen
- avoid UI-internal wording such as selector details, DOM structure, or component names
- keep language concrete enough that the scenario reads like living documentation

### 2. Keep scenarios focused

A scenario should usually prove one workflow or business outcome. If a scenario wanders across several unrelated behaviors, split it.

In Dify's suite, this means:

- one capability-focused scenario per feature path
- no long setup chains when existing bootstrap or reusable steps already cover them
- no hidden dependency on another scenario's side effects

### 3. Reuse steps, but only when behavior really matches

Good reuse reduces duplication. Bad reuse hides meaning.

Prefer reuse when:

- the user action is genuinely the same
- the expected outcome is genuinely the same
- the wording stays natural across features

Write a new step when:

- the behavior is materially different
- reusing the old wording would make the scenario misleading
- a supposedly generic step would become an implementation-detail wrapper

### 4. Prefer Cucumber Expressions

Use Cucumber Expressions for parameters unless regex is clearly necessary.

Common examples:

- `{string}` for labels, names, and visible text
- `{int}` for counts
- `{float}` for decimal values
- `{word}` only when the value is truly a single token

Keep expressions readable. If a step needs complicated parsing logic, first ask whether the scenario wording should be simpler.

### 5. Keep step definitions thin and meaningful

Step definitions are glue between Gherkin and automation, not a second abstraction language.

For Dify:

- type `this` as `DifyWorld`
- use `async function`
- keep each step to one user-visible action or assertion
- rely on `DifyWorld` and existing support code for shared context
- avoid leaking cross-scenario state

### 6. Use tags intentionally

Tags should communicate run scope or session semantics, not become ad hoc metadata.

In Dify's current suite:

- capability tags group related scenarios
- `@unauthenticated` changes session behavior
- `@authenticated` is descriptive/selective, not a behavior switch by itself
- `@fresh` belongs to reset/full-install flows only

If a proposed tag implies behavior, verify that hooks or runner configuration actually implement it.

## Review Questions

- Does the scenario read like a real example of product behavior?
- Are the steps behavior-oriented instead of implementation-oriented?
- Is a reused step still truthful in this feature?
- Is a new tag documenting real behavior, or inventing semantics that the suite does not implement?
- Would a new reader understand the outcome without opening the step-definition file?
