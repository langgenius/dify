@apps @authenticated @core
Feature: Duplicate app
  Scenario: Duplicate an existing app and open the copy in the editor
    Given I am signed in as the default E2E admin
    And there is an existing E2E app available for testing
    When I open the apps console
    And I open the options menu for the last created E2E app
    And I click "Duplicate" in the app options menu
    And I confirm the app duplication
    Then I should land on the app editor
