@agent-v2 @authenticated @access-point
Feature: Agent v2 Access Point
  @core
  Scenario: Access Point shows the available Agent v2 access surfaces
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    Then I should see the Agent v2 Access Point overview

  @core @web-app-access
  Scenario: Web app access URL can be copied without changing orchestration
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    And Agent v2 Web app access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    Then I should see the Agent v2 Web app access URL
    And I record the current Agent v2 orchestration draft
    When I copy the Agent v2 Web app access URL
    Then the Agent v2 Web app access URL should show it was copied
    And the current Agent v2 orchestration draft should be unchanged

  @core @web-app-access @published-web-app
  Scenario: Published Web app can be launched from Access Point
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    And the Agent v2 draft has been published via API
    And Agent v2 Web app access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    Then I should see the Agent v2 Web app access URL
    And I record the current Agent v2 orchestration draft
    When I launch the Agent v2 Web app
    Then the Agent v2 Web app should open in a new tab
    And the current Agent v2 orchestration draft should be unchanged

  @core @web-app-access
  Scenario: Web app Embedded configuration opens from Access Point
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    And Agent v2 Web app access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    And I record the current Agent v2 orchestration draft
    And I open Agent v2 Embedded configuration
    Then I should see the Agent v2 Embedded configuration dialog
    And the current Agent v2 orchestration draft should be unchanged

  @core @web-app-access
  Scenario: Web app customization opens from Access Point
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    And Agent v2 Web app access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    And I record the current Agent v2 orchestration draft
    And I open Agent v2 Web app customization
    Then I should see the Agent v2 Web app customization dialog
    And the current Agent v2 orchestration draft should be unchanged

  @core @web-app-access
  Scenario: Web app settings open from Access Point without changing orchestration
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    And Agent v2 Web app access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    And I record the current Agent v2 orchestration draft
    And I open Agent v2 Web app settings
    Then I should see the Agent v2 Web app settings dialog
    And the current Agent v2 orchestration draft should be unchanged

  @core @web-app-access @published-web-app
  Scenario: Web app access can be disabled and restored from Access Point
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    And the Agent v2 draft has been published via API
    And Agent v2 Web app access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    And I disable Agent v2 Web app access
    Then Agent v2 Web app access should be out of service
    When I enable Agent v2 Web app access
    Then Agent v2 Web app access should be in service
    When I refresh the current page
    Then Agent v2 Web app access should be in service

  @web-app-access @published-web-app @feature-gated
  Scenario: Disabled Web app public URL shows an unavailable state
    Given I am signed in as the default E2E admin
    And Agent v2 disabled Web app public unavailable state is available
    And a basic configured Agent v2 test agent has been created via API
    And the Agent v2 draft has been published via API
    And Agent v2 Web app access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    And I disable Agent v2 Web app access
    Then Agent v2 Web app access should be out of service
    When I open the disabled Agent v2 Web app URL
    Then the disabled Agent v2 Web app should show an unavailable state

  @core @workflow-reference
  Scenario: Workflow access shows the referencing workflow
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With Workflow Reference" is available
    And the Agent Builder preseeded workflow "E2E Agent Reference Workflow" is available
    And the Agent Builder preseeded Agent "E2E Agent With Workflow Reference" is referenced by workflow "E2E Agent Reference Workflow"
    When I open the preseeded Agent v2 Access Point page for "E2E Agent With Workflow Reference" from the Agent Roster
    Then I should see the Agent v2 Workflow access reference for "E2E Agent Reference Workflow"
    When I open the Agent v2 Workflow access reference for "E2E Agent Reference Workflow"
    Then the Agent v2 Workflow access reference for "E2E Agent Reference Workflow" should open in Studio

  @core @backend-api-access
  Scenario: Backend service API endpoint can be copied
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And Agent v2 Backend service API access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    Then I should see the Agent v2 Backend service API endpoint
    When I copy the Agent v2 Backend service API endpoint
    Then the Agent v2 Backend service API endpoint should show it was copied

  @core @backend-api-access
  Scenario: Backend service API keys are managed without exposing existing secrets
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And Agent v2 Backend service API access has been enabled with a key via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    And I open Agent v2 API key management
    Then Agent v2 API keys should not expose a secret by default
    When I create a new Agent v2 API key
    Then I should see the newly generated Agent v2 API key once
    When I copy the newly generated Agent v2 API key
    Then the newly generated Agent v2 API key should show it was copied
    When I close the newly generated Agent v2 API key
    Then the Agent v2 API key list should not expose the full generated secret

  @core @backend-api-access
  Scenario: Backend service API Reference opens from Access Point
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And Agent v2 Backend service API access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    And I open the Agent v2 API Reference
    Then the Agent v2 API Reference should open in a new tab

  @core @backend-api-access
  Scenario: Backend service API access can be disabled and restored from Access Point
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And Agent v2 Backend service API access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    And I disable Agent v2 Backend service API access
    Then Agent v2 Backend service API access should be out of service
    When I enable Agent v2 Backend service API access
    Then Agent v2 Backend service API access should be in service
    When I refresh the current page
    Then Agent v2 Backend service API access should be in service

  @service-api-runtime @external-model @agent-backend-runtime @backend-api-access @stable-model
  Scenario: Published Agent v2 answers through Backend service API
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent v2 runtime backend is available
    And a runnable Agent v2 test agent has been created via API
    And Agent v2 Backend service API access has been enabled with a key via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I send the Agent v2 Backend service API minimal request
    Then the Agent v2 Backend service API request should succeed with the normal E2E marker

  @service-api-runtime @external-model @agent-backend-runtime @backend-api-access @stable-model
  Scenario: Disabled Backend service API rejects requests and restored access succeeds
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent v2 runtime backend is available
    And a runnable Agent v2 test agent has been created via API
    And the Agent v2 draft has been published via API
    And Agent v2 Backend service API access has been enabled with a key via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    And I disable Agent v2 Backend service API access
    Then Agent v2 Backend service API access should be out of service
    When I send the Agent v2 Backend service API minimal request
    Then the Agent v2 Backend service API request should be rejected while disabled
    When I enable Agent v2 Backend service API access
    Then Agent v2 Backend service API access should be in service
    When I send the Agent v2 Backend service API minimal request
    Then the Agent v2 Backend service API request should succeed with the normal E2E marker
