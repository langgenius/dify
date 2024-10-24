# Cypress Support Folder
The support folder contains utility functions and commands that are used in the tests.
- [commands.ts](/web/cypress/support/commands.ts): Contains custom Cypress commands.
- [db.ts](/web/cypress/support/db.ts): Contains functions to interact with the database.
- [e2e.ts](/web/cypress/support/e2e.ts): Is the entry point for the support files.

## Cypress Commands
We use [Cypress Commands](https://docs.cypress.io/api/cypress-api/custom-commands) to interact with the database and the backend. This allows us to perform actions like creating an admin account or logging in a user before running the tests. The commands are defined in the [commands.ts](/web/cypress/support/commands.ts) file.

### Available commands
- `cy.clearDatabase()`: Clears the database and ensures a clean setup before running the tests.
- `cy.installDify()`: Performs the initial setup of Dify and creates an admin account.
- `cy.login(email: string, password: string)`: Logs in a user with the given email and password.