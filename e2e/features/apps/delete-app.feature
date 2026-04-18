@apps @authenticated @core
Feature: Delete app
  Scenario: Delete an existing app from the apps console
    Given I am signed in as the default E2E admin
    And there is an existing E2E app available for testing
    When I open the apps console
    And I open the options menu for the last created E2E app
    And I click "Delete" in the app options menu
    And I type the app name in the deletion confirmation
    And I confirm the deletion
    Then the app should no longer appear in the apps console
