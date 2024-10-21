import { When } from '@badeball/cypress-cucumber-preprocessor'
import '../shared-steps'

When('I enter valid credentials', () => {
  cy.fixture('user').then((user) => {
    cy.get('[data-testid=email-input]').type(user.email)
    cy.get('[data-testid=password-input]').type(user.password)
  })
})

When('I enter invalid credentials', () => {
  cy.get('[data-testid=email-input]').type('test@example.com')
  cy.get('[data-testid=password-input]').type('invalidPassword')
})
