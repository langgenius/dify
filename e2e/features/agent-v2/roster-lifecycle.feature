@agent-v2 @authenticated @core @agent-lifecycle
Feature: Agent v2 roster lifecycle
  Scenario: Editing a copy of a published Agent leaves the source configuration unchanged
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    And the Agent v2 draft has been published via API
    When I duplicate the configured Agent v2 from the Agent Roster
    And I open the Agent v2 configure page
    Then the copied Agent v2 should start with an unpublished configuration
    And I should see the normal E2E prompt in the Agent v2 prompt editor
    When I fill the Agent v2 prompt editor with the updated E2E prompt
    Then the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should use the updated E2E prompt
    When I reopen the original Agent v2 configuration
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And the original Agent v2 draft should remain unchanged

  Scenario: Deleting an Agent removes it from the refreshed roster
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I delete the configured Agent v2 from the Agent Roster
    Then the deleted Agent v2 should stay absent after refreshing the roster
