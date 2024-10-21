import { Before, BeforeStep, Given, Then, When } from '@badeball/cypress-cucumber-preprocessor'
/**
 * This step definition file is shared between multiple feature files.
 * Add step defitions here that can be reused between multiple tests.
 *
 * Best Practices:
 * - Use parameterized step definitions to make them more reusable.
 * - Only do one thing in each step definition. Create commands if you need to do multiple things.
 *   For commands, see /web/cypress/support/commands.ts
 * - If you want to share steps that are tied to a specific feature, create a shared-steps file in that feature folder.
 */

/**
 * BeforeStep hooks
 * Define actions that should be executed before a step, such as preparing the database.
 *
 * Best Practices:
 * - Use tags to control when a before step should be executed.
 *   - Name tags by the action they perform,
 *     since they are used to perform actions before steps.
 */

// This hook will prevent the test from failing when an error is expected.
BeforeStep({ tags: '@expectError' }, () => {
  cy.on('uncaught:exception', (_err) => {
    return false
  })
})

/**
 * Before hooks
 * Define actions that should be executed before a scenario, such as preparing the database.
 *
 * Best Practices:
 * - Use tags to control when a before step should be executed.
 *   - Name tags as the state they produce instead of actions,
 *     since they are used to prepare a scenario.
 */
Before({ tags: '@cleanSetup' }, () => {
  cy.clearDatabase().then((result: any) => {
    // eslint-disable-next-line no-unused-expressions
    expect(result.rows).to.be.an('array').that.is.empty
  })
})

Before({ tags: '@difyInstalled' }, () => {
  cy.installDify()
})

Before({ tags: '@loggedIn' }, () => {
  cy.fixture('user').then((user) => {
    cy.login(user.email, user.password)
  })
})

/**
 * Given steps
 * Prepare the system to be in a certain state before the user interacts with it.
 */
Given('I am on the {string} page', (page: string) => {
  cy.visit(page)
})

Given('I have created an admin account', () => {
  cy.installDify()
})

Given('I am logged in', () => {
  cy.fixture('user').then((user) => {
    cy.login(user.email, user.password)
  })
})

/**
 * When steps
 * Perform actions that change the state of the system.
 */
When('I click the {string}', (dataTestId: string) => {
  cy.get(`[data-testid=${dataTestId}]`).click()
})

/**
 * Then steps
 * Expect outcomes that are observable after the user interacts with the system.
 */
Then('I should be redirected to {string}', (path: string) => {
  cy.location('pathname').should('eq', path)
})

Then('I should stay on page {string}', (path: string) => {
  cy.location('pathname').should('eq', path)
})

Then('I should see a toast {string} message', (type: 'success' | 'error' | 'warning' | 'info') => {
  cy.get(`[data-testid=${type}-toast-message]`).should('be.visible')
})

Then('I should see the {string}', (elementName: string) => {
  cy.get(`[data-testid="${elementName}"]`)
})
