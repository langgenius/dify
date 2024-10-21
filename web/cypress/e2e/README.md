# Guidelines for Writing Feature Tests

This documentation provides guidelines on how to write feature tests using Cypress with Cucumber. It outlines conventions for using tags, defining shared steps, and selecting elements with `data-testid` attributes.

## Conventions

### Using Tags and Before Steps

In our tests, we utilize **tags** and **Before steps** for better organization and setup of our test environment. Here’s how they work:

- **Tags**: Tags are annotations applied to features or scenarios used to mark them for specific conditions or behaviors. For example, a scenario tagged with `@cleanSetup` signifies that a clean state should be established before the scenario runs. Tags can be chained together to create more complex conditions. To allow flexible test scenarios, we don't enforce a clean setup for each scenario, thats why we use tags to specify when a clean setup is required.

  ```gherkin
  @cleanSetup @loggedIn
  Scenario: User can view the studio
    Given I am on the "/apps" page
    ...
  ```

- **Before Steps**: These are special hooks executed before any step that matches the specified tags. We utilize them to define tags. Here are some common Before steps:

  - `Before({ tags: '@cleanSetup' })`: Truncates all tables in the database to ensure that tests start with a fresh environment.
  
  - `Before({ tags: '@loggedIn' })`: Logs in a user before running scenarios that require user authentication.

Read more about [tags](https://github.com/badeball/cypress-cucumber-preprocessor/blob/v21.0.2/docs/tags.md) and [hooks](https://github.com/badeball/cypress-cucumber-preprocessor/blob/v21.0.2/docs/cucumber-basics.md#hooks) in the Cypress Cucumber documentation.

### Defining Shared Steps

Shared steps allow us to write reusable step definitions that can be used across multiple feature files. These steps should follow the principles outlined below:

- **Single Responsibility**: Each step definition should perform one action. If a behavior requires multiple actions, consider creating a command in the `/web/cypress/support/commands.ts` file.

- **Parameterized Steps**: Use parameters in your step definitions to make them more flexible and reusable.

Here is an example of a shared step definition for visiting a page:

```typescript
Given('I am on the {string} page', (page: string) => {
  cy.visit(page)
})
```

Given the shared steps cover a wide range of actions, it could be possible to write new tests just by defining the feature files.

### Using `data-testid` Attributes as Selectors

When adding tests for a feature, it is a convention to use `data-testid` attributes as selectors for the elements in the UI. This approach provides several benefits:

- **Clarity**: `data-testid` attributes clearly indicate that the element is used in our tests, making the intent of the selector explicit.
- **Stability**: Unlike classes or IDs that may change based on styling or layout adjustments, `data-testid` attributes are less likely to be altered, thus maintaining selector stability across application updates. Since Dify is available in multiple languages, we should never use text as a selector.

#### Don't🚫
```typescript
When('I click on the button with text {string}', (buttonText: string) => {
  cy.contains(buttonText).click()
})
```

#### Do ✅
```typescript
When('I click the {string}', (dataTestId: string) => {
  cy.get(`[data-testid=${dataTestId}]`).click()
})
```