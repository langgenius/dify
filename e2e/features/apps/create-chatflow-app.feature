@apps @authenticated @core @mode-matrix
Feature: Create Chatflow app
  Scenario: Create a new Chatflow app and redirect to the workflow editor
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I create the "Chatflow" app from Studio
    Then I should land on the workflow editor
