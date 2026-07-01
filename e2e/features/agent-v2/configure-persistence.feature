@agent-v2 @authenticated @core
Feature: Agent v2 configure persistence
  @configure-persistence
  Scenario: Persisted Agent v2 instructions remain visible after refresh
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I fill the Agent v2 prompt editor with the normal E2E prompt
    Then the normal Agent v2 draft should use the normal E2E prompt
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
