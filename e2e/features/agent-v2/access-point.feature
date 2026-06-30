@agent-v2 @authenticated @access-point @core
Feature: Agent v2 Access Point
  Scenario: Access Point shows the available Agent v2 access surfaces
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    When I open the Agent v2 Access Point page
    Then I should see the Agent v2 Access Point overview

  Scenario: Backend service API shows endpoint, key management, and API reference entry
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And Agent v2 Backend service API access has been enabled via API
    When I open the Agent v2 Access Point page
    Then I should see the Agent v2 Backend service API endpoint
    And I should see the Agent v2 API Reference entry
    And I should be able to open Agent v2 API key management without exposing a secret by default
