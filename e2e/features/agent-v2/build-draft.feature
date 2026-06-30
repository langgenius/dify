@agent-v2 @authenticated @build @core
Feature: Agent v2 build draft
  Scenario: Discarding a Build draft keeps the original Agent configuration
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And the Agent v2 composer draft uses the normal E2E prompt
    And an Agent v2 Build draft uses the updated E2E prompt
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Build draft pending changes
    And I should see the updated E2E prompt in the Agent v2 prompt editor
    When I discard the Agent v2 Build draft
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And the Agent v2 Build draft should no longer be active
    When I refresh the current page
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And the Agent v2 Build draft should no longer be active
