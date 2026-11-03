@apps @authenticated @core
Feature: Switch app mode
  Scenario: Switch a Completion app to Workflow Orchestrate
    Given I am signed in as the default E2E admin
    And there is an existing E2E completion app available for testing
    When I open the apps console
    And I open the options menu for the last created E2E app
    And I click "Switch to Workflow Orchestrate" in the app options menu
    And I confirm the app switch
    Then I should land on the switched app
