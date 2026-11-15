@agent-v2 @authenticated @infra
Feature: Agent v2 configure entry
  Scenario: Open the configure page for an Agent v2 test agent
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And a minimal Agent v2 composer draft has been synced
    When I open the Agent v2 configure page
    Then I should be on the Agent v2 configure page
    And I should see the Agent v2 configure workspace
