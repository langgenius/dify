@agent-v2 @authenticated @core
Feature: Agent v2 configure persistence
  Scenario: Persisted Agent v2 instructions remain visible after refresh
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And the Agent v2 composer draft uses the normal E2E prompt
    When I open the Agent v2 configure page
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    When I refresh the current page
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
