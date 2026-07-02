@agent-v2 @authenticated @core
Feature: Agent v2 configure persistence
  @configure-persistence @stable-model
  Scenario: Selecting a stable model in Configure persists after refresh
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And an Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I select the stable E2E model in the Agent v2 model selector
    And I fill the Agent v2 prompt editor with the normal E2E prompt
    Then the Agent v2 configuration should be saved automatically
    And the Agent v2 draft should use the stable E2E model
    And the normal Agent v2 draft should use the normal E2E prompt
    When I refresh the current page
    Then I should see the stable E2E model in the Agent v2 model selector
    And I should see the normal E2E prompt in the Agent v2 prompt editor
    And the Agent v2 draft should use the stable E2E model

  @configure-persistence @stable-model
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
  Scenario: Leaving Configure immediately after editing preserves prompt changes
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I fill the Agent v2 prompt editor with the updated E2E prompt
    And I leave the Agent v2 configure page immediately after editing
    When I open the Agent v2 configure page from the Agent Roster
    Then I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should use the updated E2E prompt

  @configure-persistence
  Scenario: Concurrent Agent v2 edits converge to one clear saved draft after refresh
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I open the same Agent v2 configure page in another tab
    And I save the Agent v2 prompt from the first configure tab
    And I save the Agent v2 prompt from the second configure tab
    When I refresh both Agent v2 configure tabs
    Then both Agent v2 configure tabs and the Agent v2 draft should show one saved concurrent prompt
