@agent-v2 @authenticated @publish @core
Feature: Agent v2 publish
  Scenario: Publish a configured Agent v2 draft
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date

  Scenario: Publish action follows unpublished changes
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then the Agent v2 publish action should be available for unpublished changes
    When I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    And the Agent v2 publish action should be unavailable while up to date
    When I fill the Agent v2 prompt editor with the updated E2E prompt
    Then the Agent v2 configuration should be saved automatically
    And the Agent v2 publish action should be available for unpublished changes

  Scenario: Published Agent v2 version remains isolated from draft edits
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I fill the Agent v2 prompt editor with the updated E2E prompt
    Then the Agent v2 configuration should be saved automatically
    And the normal Agent v2 draft should use the updated E2E prompt
    And the active published Agent v2 version should still use the normal E2E prompt
