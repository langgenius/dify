@agent-v2 @authenticated @advanced-settings @core
Feature: Agent v2 advanced settings
  Scenario: Plain environment variables are saved and restored
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I add the plain Agent v2 environment variable from Advanced Settings
    Then the plain Agent v2 environment variable should be saved in the Agent v2 draft
    When I refresh the current page
    Then I should see the plain Agent v2 environment variable in Advanced Settings
