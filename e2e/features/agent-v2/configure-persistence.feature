@agent-v2 @authenticated @core
Feature: Agent v2 configure persistence
  @configure-persistence
  Scenario: Persisted Agent v2 instructions remain visible after refresh
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I fill the Agent v2 prompt editor with the normal E2E prompt
    Then the normal Agent v2 draft should use the normal E2E prompt
    And the Agent v2 draft should use the stable E2E model
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And I should see the stable E2E model in the Agent v2 model selector
    And the Agent v2 draft should use the stable E2E model

  @configure-persistence
  Scenario: Leaving Configure before autosave completes preserves prompt changes
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I fill the Agent v2 prompt editor with the updated E2E prompt
    And I leave the Agent v2 configure page before autosave completes
    When I open the Agent v2 configure page from the Agent Roster
    Then I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should use the updated E2E prompt
