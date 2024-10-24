# Cypress Testing (E2E Testing)
We use [Cypress](https://www.cypress.io/) for end-to-end testing. Cypress is a modern test runner that enables you to write tests in TypeScript that runs in a real browser. It is fast, reliable, and easy to use.

## Cypres Cucumber
We use [Cypress Cucumber](https://github.com/badeball/cypress-cucumber-preprocessor) which is a plugin that allows us to write Cypress tests in Gherkin syntax. This makes it easier to write tests in a more human-readable format and also acts as documentation for the features.

### Gherkin Syntax
Gherkin is a domain-specific language for describing software behavior in a natural language style. It is used to define features and scenarios in a human-readable format. Here is an example of a Gherkin syntax:

```gherkin
Feature: Login
  As a user
  I want to login to the application
  So that I can access my account

  Scenario: Successful login with username and password
    Given I am on the "/login" page
    And I have created an admin account
    When I enter valid credentials
    And I click on the Sign In button
    Then I should be redirected to the dashboard
```

### Test files structure
The test files are structured in the following way:

```
web/cypress
├── fixtures
│   └── user.json
├── e2e
│   ├── auth
│   │   ├── login.feature
│   │   └── login.ts
├── support
│   ├── commands.ts
│   └── db.ts
│   └── e2e.ts
web/cypress.config.ts
web/tsconfig.cypress.json
```

## Run tests
To run tests during development, open the cypress UI by running the following command:

```bash
yarn cy:open
```
You will have to run the required services before opening the cypress UI. You can do this by running `yarn dev` to start the web app and `yarn cy:docker:start-services` to start the api and databases for the cypress environment.

Use the following command to run the required services and open the cypress UI:
```bash
yarn test:e2e
```

To run the tests without opening the UI, use the following command:

```bash
yarn test:e2e:ci
```

### Cypress UI with Devcontainer (Windows, Mac, Linux)
If you are developing in a devcontainer, you will need to enable additional features to be able to see the cypress UI. To do this, enable the following in the devcontainer.json file:

```json
"ghcr.io/devcontainers/features/desktop-lite:1": {
			// Required to run a GUI for Cypress (yarn cy:open)
}
```
And forward the port 6080 to the host machine. You can then visit localhost:6080 to see a desktop with the cypress UI window in the browser.
```json
"forwardPorts": [ 
		6080 // VNC client for Cypress
	 ],
```

### Cypress UI with WSL (Windows Subsystem for Linux)
For a better developer experience on windows, install [VcXsrv](https://sourceforge.net/projects/vcxsrv/). This will allow you to open the ui in a separate window instead of having to use the noVNC UI at http://localhost:6080/.

After launching the VcXsrv, run the following command to open the cypress UI:

```bash
cy:open:wsl
```
Or to run the required services and open the cypress UI:

```bash
yarn test:e2e:wsl
```

### Scripts
Hrere are all script that can be used to run the tests. Dependencies are the services that need to be running before executing the script. Services executed are the services that are started by the script.

| Script              | Dependencies                    | Services Executed       |
|---------------------|---------------------------------|-------------------------|
| `yarn cy:open`      | `web` `api` `databases`         | none                    |
| `yarn cy:run`       | `web` `api` `databases`         | none                    |
| `yarn cy:open:wsl`  | `web` `api` `databases`  VcXsrv | none                    |
| `yarn test:e2e`     | none                            | `web` `api` `databases` |
| `yarn test:e2e:ci`  | None                            | `web` `api` `databases` |
| `yarn test:e2e:wsl` | VcXsrv                          | `web` `api` `databases` |



## Cypress test environment
Our cypress tests interact with the backend and the databases. To achieve this, we have a separate [docker-compose.cypress.yaml](/docker/docker-compose.cypress.yaml) that defines the services required for the tests. To isolate the persistence of the data, we mount volumes of the services to the [docker/volumes/cypress](docker/volumes/cypress) directory.

### Services excluded from the cypress environment
- **nginx**: The nginx service is not required for the cypress environment. The cypress tests interact with the frontend and backend directly.
- **worker**: The current setup does not yet require the worker service for the cypress environment. It will be needed if we have tests for knowledge indexing. Since this service would be too time consuming to run in the cypress environment, we can exclude it for now and mock the responses to test features like the retrieval testing.
- **vector database**: Like the worker, the vector database (which is only used for knowledge indexing) is not required for the current tet setup as we do not have tests for knowledge indexing. We can still create knowledges, the documents just don't get indexed and knowledge retrieval will not work.


## Database & Persistence
To ensure that the tests are isolated and do not affect each other, we use custom cypress commands that truncate the tables before each test. Read more about this in the [Cypress Commands documentation](support/README.md#cypress-commands).

This means, each test may start with a clean database state. This is important to ensure that the tests are reliable and do not depend on the state of the database.