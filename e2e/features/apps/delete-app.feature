@apps @authenticated
Feature: Delete app
  Scenario: Create and delete an app from the apps console
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I start creating a blank app
    And I enter a unique E2E app name
    And I confirm app creation
    Then I should land on the app editor
    When I navigate back to the apps console
    And I delete the last created E2E app
    Then the app should no longer appear in the apps list
