@apps @authenticated @core
Feature: Export app DSL
  Scenario: Export the DSL file for an existing app
    Given I am signed in as the default E2E admin
    And there is an existing E2E completion app available for testing
    When I open the apps console
    And I open the options menu for the last created E2E app
    And I click "Export DSL" in the app options menu
    Then a YAML file named after the app should be downloaded
