@apps @authenticated @core @mode-matrix
Feature: Create Agent app
  Scenario: Create a new Agent app and redirect to the configuration page
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I create the "Agent" app from Studio
    Then I should land on the app configuration page
