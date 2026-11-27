@apps @authenticated @core @mode-matrix
Feature: Create Text Generator app
  Scenario: Create a new Text Generator app and redirect to the configuration page
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I start creating a blank app
    And I expand the beginner app types
    And I select the "Text Generator" app type
    And I enter a unique E2E app name
    And I confirm app creation
    Then I should land on the app configuration page
