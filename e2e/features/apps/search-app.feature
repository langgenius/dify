@apps @authenticated @core
Feature: Search app
  Scenario: Search an existing app by name from the apps console
    Given I am signed in as the default E2E admin
    And there is an existing E2E app available for testing
    When I open the apps console
    And I search for the last created E2E app
    Then I should see the last created E2E app in the apps console
