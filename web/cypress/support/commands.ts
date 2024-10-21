/// <reference types="cypress" />

// Learn more about our custom commands in
// /docs/cypress/commands.md

/**
 * Command: installDify
 * Thiss step will setup the dify instance and create an initial accout.
 * It will success also if the instance is already setup and the account already exists.
 */
Cypress.Commands.add('installDify', (): Cypress.Chainable => {
  return cy.wrap(new Promise<any>((resolve) => {
    cy.fixture('user').then((user) => {
      cy.request({
        method: 'POST',
        url: 'http://localhost:5001/console/api/setup',
        body: {
          ...user,
          name: 'Cypress',
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.be.oneOf(
          [
            201, // we expect 201 if the account is created
            403, // we expect 403 if the initial account already exists
          ])
        resolve(response)
      })
    })
  }))
})

Cypress.Commands.add('login', (email: string, password: string): Cypress.Chainable<void> => {
  return cy.wrap(new Promise<void>((resolve) => {
    cy.request({
      method: 'POST',
      url: 'http://localhost:5001/console/api/login',
      body: {
        email,
        password,
        remember_me: true,
      },
    }).then((response) => {
      expect(response.status).to.be.eq(200)
      const cookies = response.headers['set-cookie']
      const cookie = typeof cookies === 'string' ? cookies : cookies.map((cookie: string) => cookie.split(';')[0]).join(';')
      cy.setCookie('session', cookie as string)

      // set local storage console_token from response.body.data
      cy.window().its('localStorage').invoke('setItem', 'console_token', response.body.data.access_token)

      resolve()
    })
  }))
})

Cypress.Commands.add('clearDatabase', () => {
  return cy.task('runQuery', {
    query: `
      DO $$ 
      DECLARE 
          r RECORD; 
      BEGIN 
          FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP 
              EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; 
          END LOOP; 
      END $$;`,
  })
})

declare global {
  namespace Cypress {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Chainable {
      installDify(): Chainable
      login(email: string, password: string): Chainable<void>
      clearDatabase(): Chainable
    }
  }
}

export {}
