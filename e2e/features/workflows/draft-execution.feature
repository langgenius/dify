@workflows @authenticated @core
Feature: Execute saved workflow edits
  Scenario: A template edited in the workflow canvas survives reload and controls the run result
    Given a template workflow returning "E2EOriginalResult" has been created
    When I open the app from the app list
    And I change the workflow result template to "E2ESavedResult"
    Then the workflow result template should be saved as "E2ESavedResult"
    When I reload the workflow editor
    Then the workflow template editor should contain "E2ESavedResult"
    When I run the workflow
    Then the workflow test run should return "E2ESavedResult"
