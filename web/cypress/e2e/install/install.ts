import { When } from '@badeball/cypress-cucumber-preprocessor'
import '../shared-steps'

When('I enter valid form data', () => {
  cy.fixture('user').then((user) => {
    cy.get('[data-testid="email-input"]').type(user.email)
    cy.get('[data-testid="name-input"]').type('Cypress')
    cy.get('[data-testid="password-input"]').type(user.password)
  })
})

When('I enter an invalid email', () => {
  cy.get('[data-testid="email-input"]').type('foo')
})

When('I enter an invalid name', () => {
  cy.get('[data-testid="name-input"]').type('123456789123456789123456789')
})

When('I enter an invalid password', () => {
  cy.get('[data-testid="password-input"]').type('1')
})
