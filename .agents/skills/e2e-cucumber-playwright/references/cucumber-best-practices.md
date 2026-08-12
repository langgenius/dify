# Cucumber Best Practices

Use this reference when writing or reviewing Gherkin scenarios, step definitions, parameter expressions, and step reuse.

Official sources:

- https://cucumber.io/docs/guides/10-minute-tutorial
- https://cucumber.io/docs/cucumber/step-definitions
- https://cucumber.io/docs/cucumber/cucumber-expressions

## What Matters Most

### 1. Treat scenarios as executable specifications

Cucumber scenarios should describe examples of behavior, not test implementation recipes.

Apply it like this:

- write what the user does and what should happen
- avoid UI-internal wording such as selector details, DOM structure, or component names
- keep language concrete enough that the scenario reads like living documentation

### 2. Keep scenarios focused

A scenario should usually prove one workflow or business outcome. If a scenario wanders across several unrelated behaviors, split it.

Keep each scenario centered on one coherent outcome. Avoid hidden dependencies on another scenario's side effects, and keep unavoidable setup outside the behavior narrative unless the precondition matters to the specification.

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

Step definitions are glue between Gherkin and automation, not a second abstraction language.

Keep each step to one user-visible action or assertion. In JavaScript and TypeScript, use `async function` when the step reads Cucumber World state because Cucumber binds `this`; do not leak state across scenarios through module globals.

### 6. Use tags intentionally

Tags should communicate selection or execution intent, not become ad hoc metadata. A tag does not change runtime behavior unless configuration or hooks implement it.

## Review Questions

- Does the scenario read like a real example of product behavior?
- Are the steps behavior-oriented instead of implementation-oriented?
- Is a reused step still truthful in this feature?
- Is a new tag documenting real behavior, or inventing semantics that the suite does not implement?
- Would a new reader understand the outcome without opening the step-definition file?
