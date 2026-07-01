@agent-v2 @authenticated @publish
Feature: Agent v2 publish
  @core @stable-model
  Scenario: Publish a configured Agent v2 draft
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date

  @core @stable-model
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

  @core @stable-model
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

  @core @stable-model
  Scenario: Restoring a published Agent v2 version shows the restored configuration in Builder
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I fill the Agent v2 prompt editor with the updated E2E prompt
    Then the Agent v2 configuration should be saved automatically
    And the normal Agent v2 draft should use the updated E2E prompt
    When I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I open the Agent v2 version history
    And I select Agent v2 published version 1
    Then the selected Agent v2 version should be displayed in view-only mode
    And I should see the normal E2E prompt in the Agent v2 prompt editor
    When I restore the selected Agent v2 version
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should use the normal E2E prompt
    And the Agent v2 publish action should be available for unpublished changes

  @web-app-runtime @published-web-app @stable-model
  Scenario: Published Web app remains isolated from unpublished Agent v2 draft edits
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    And Agent v2 Web app access has been enabled via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I fill the Agent v2 prompt editor with the updated E2E prompt
    Then the Agent v2 configuration should be saved automatically
    And the normal Agent v2 draft should use the updated E2E prompt
    When I open the Agent v2 Web app URL
    And I send an E2E message in the Agent v2 Web app
    Then the Agent v2 Web app response should include the normal E2E marker
    And the Agent v2 Web app response should not include the updated E2E marker

  @web-app-runtime @published-web-app @stable-model
  Scenario: Published Web app uses the latest Agent v2 published configuration
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    And Agent v2 Web app access has been enabled via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I fill the Agent v2 prompt editor with the updated E2E prompt
    Then the Agent v2 configuration should be saved automatically
    And the normal Agent v2 draft should use the updated E2E prompt
    When I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I open the Agent v2 Web app URL
    And I send an E2E message in the Agent v2 Web app
    Then the Agent v2 Web app response should include the updated E2E marker
