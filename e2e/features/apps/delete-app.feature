@apps @authenticated
Feature: Delete app
  Scenario: Create an app then delete it from the apps console
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I start creating a blank app
    And I select the "Workflow" app type
    And I enter a unique E2E app name
    And I confirm app creation
    And I should land on the workflow editor
    And I open the apps console
    And I open the context menu for the created app
    And I click "Delete" in the context menu
    And I confirm app deletion by typing the app name
    Then the app should be deleted successfully
