@agent-v2 @authenticated @publish
Feature: Agent v2 publish
  Background:
    Given I am signed in as the default E2E admin

  @core @prepared @stable-model
  Scenario: Publish a configured Agent v2 draft
    Given the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 first publication should succeed

  @core @prepared @stable-model
  Scenario: Publish guidance opens Agent v2 access methods
    Given the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    And I follow the access methods link in the Agent v2 publish guidance
    Then the Agent v2 Access Point should open

  @core @prepared @stable-model @published-web-app
  Scenario: Publish guidance opens the Agent v2 Web app
    Given the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    And I follow the Web app link in the Agent v2 publish guidance
    Then the Agent v2 Web app should open in a new tab

  @core @prepared @stable-model
  Scenario: Editing a published Agent v2 enables Publish update
    Given the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    And the Agent v2 draft has been published via API
    When I open the Agent v2 configure page
    And I fill the Agent v2 prompt editor with the updated E2E prompt
    Then the Agent v2 Publish update action should be available

  @core @prepared @stable-model
  Scenario: Publishing Agent v2 draft changes shows update guidance
    Given the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    And the Agent v2 draft has been published via API
    When I open the Agent v2 configure page
    And I fill the Agent v2 prompt editor with the updated E2E prompt
    And I publish the Agent v2 draft
    Then the Agent v2 update publication should succeed

  @core @prepared @stable-model
  Scenario: Viewing a published Agent v2 version is read-only
    Given the Agent Builder stable chat model is available
    And an Agent v2 has original and updated published prompts
    When I view the original Agent v2 published version in version history
    Then the original Agent v2 version should be view-only

  @core @prepared @stable-model
  Scenario: Restoring a published Agent v2 version shows the restored configuration in Builder
    Given the Agent Builder stable chat model is available
    And an Agent v2 has original and updated published prompts
    When I view the original Agent v2 published version in version history
    And I restore the selected Agent v2 version
    Then the original Agent v2 configuration should be an unpublished draft

  @web-app-runtime @external-model @agent-backend-runtime @published-web-app @stable-model
  Scenario: Published Agent v2 answers through Web app
    Given the Agent Builder stable chat model is available
    And the Agent v2 runtime backend is available
    And a runnable Agent v2 test agent has been created via API
    And the Agent v2 draft has been published via API
    When I open the Agent v2 Web app URL
    And I send an E2E message in the Agent v2 Web app
    Then the Agent v2 Web app response should include the normal E2E marker

  @web-app-runtime @external-model @agent-backend-runtime @published-web-app @stable-model
  Scenario: Published Web app remains isolated from unpublished Agent v2 draft edits
    Given the Agent Builder stable chat model is available
    And the Agent v2 runtime backend is available
    And a runnable Agent v2 test agent has been created via API
    And the Agent v2 draft has been published via API
    And the Agent v2 draft has unpublished updated prompt changes
    When I open the Agent v2 Web app URL
    And I send an E2E message in the Agent v2 Web app
    Then the Agent v2 Web app response should include the normal E2E marker
    And the Agent v2 Web app response should not include the updated E2E marker

  @web-app-runtime @external-model @agent-backend-runtime @published-web-app @stable-model
  Scenario: Published Web app uses the latest Agent v2 published configuration
    Given the Agent Builder stable chat model is available
    And the Agent v2 runtime backend is available
    And an Agent v2 has original and updated published prompts
    When I open the Agent v2 Web app URL
    And I send an E2E message in the Agent v2 Web app
    Then the Agent v2 Web app response should include the updated E2E marker
