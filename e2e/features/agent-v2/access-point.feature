@agent-v2 @authenticated @access-point @core
Feature: Agent v2 Access Point
  Scenario: Access Point shows the available Agent v2 access surfaces
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    When I open the Agent v2 Access Point page
    Then I should see the Agent v2 Access Point overview

  Scenario: Backend service API supports endpoint copy, key creation, and API reference navigation
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And Agent v2 Backend service API access has been enabled via API
    When I open the Agent v2 configure page from the Agent Roster
    And I switch to the Agent v2 Access Point section
    Then I should see the Agent v2 Backend service API endpoint
    When I copy the Agent v2 Backend service API endpoint
    Then the Agent v2 Backend service API endpoint should show it was copied
    When I open Agent v2 API key management
    Then Agent v2 API keys should not expose a secret by default
    When I create a new Agent v2 API key
    Then I should see the newly generated Agent v2 API key once
    When I close the newly generated Agent v2 API key
    Then the Agent v2 API key list should not expose the full generated secret
    When I close Agent v2 API key management
    And I open the Agent v2 API Reference
    Then the Agent v2 API Reference should open in a new tab
