@apps @authenticated @core
Feature: Edit app settings

  Scenario: Edit app name and description from the apps console
    Given I am signed in as the default E2E admin
    And there is an existing E2E app available for testing
    When I open the apps console
    And I open the options menu for the last created E2E app
    And I click "Edit App" in the app options menu
    And I update the app name to "E2E Renamed App"
    And I update the app description to "Updated by E2E test"
    And I save the app settings
    Then the app should display the updated name in the apps console
