@agent-v2 @authenticated @preview
Feature: Agent v2 configure validation
  Scenario: Preview is unavailable until a required model is configured
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And the Agent v2 composer draft uses the normal E2E prompt
    When I open the Agent v2 configure page
    Then Agent v2 Preview should be unavailable until a model is configured
    And I should see the normal E2E prompt in the Agent v2 prompt editor
