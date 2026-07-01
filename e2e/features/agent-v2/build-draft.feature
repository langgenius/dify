@agent-v2 @authenticated @build @core
Feature: Agent v2 build draft
  Scenario: Generating a Build draft leaves the normal Agent configuration unchanged
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent Builder preseeded tool "JSON Process / JSON Replace" is available
    And a runnable Agent v2 test agent has been created via API
    And the e2e-summary-skill Skill is available to the Agent v2 test agent
    When I open the Agent v2 configure page
    And I generate an Agent v2 Build draft from the fixed instruction
    Then I should see the Agent v2 Build draft pending changes
    And I should see the Agent v2 Build mode confirmation state
    And the normal Agent v2 draft should still use the normal E2E prompt

  Scenario: Discarding a Build draft keeps the original Agent configuration
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And the Agent v2 composer draft uses the normal E2E prompt
    And an Agent v2 Build draft uses the updated E2E prompt
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Build draft pending changes
    And I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should still use the normal E2E prompt
    When I discard the Agent v2 Build draft
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And the Agent v2 Build draft should no longer be active
    When I refresh the current page
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And the Agent v2 Build draft should no longer be active

  Scenario: Applying a pending Build draft updates the normal Agent configuration
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    And an Agent v2 Build draft uses the updated E2E prompt with the stable E2E model
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Build draft pending changes
    And I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should still use the normal E2E prompt
    When I apply the Agent v2 Build draft
    Then I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should use the updated E2E prompt
    And the Agent v2 Build draft should no longer be active
    When I refresh the current page
    Then I should see the updated E2E prompt in the Agent v2 prompt editor
    And the Agent v2 Build draft should no longer be active

  @build-tool-writeback @feature-gated
  Scenario: Applying a Build draft can add Dify Tools to the Agent configuration
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 Build chat Dify Tool writeback should be available
