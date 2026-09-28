@apps @authenticated @core @mode-matrix
Feature: Create Text Generator app
  Scenario: Create a new Text Generator app and redirect to the configuration page
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I create the "Text Generator" app from Studio
    Then I should land on the app configuration page
