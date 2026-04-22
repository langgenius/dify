@apps @authenticated
Feature: Create app
  Scenario: Create a new blank app and redirect to the editor
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I start creating a blank app
    And I enter a unique E2E app name
    And I confirm app creation
    Then I should land on the app editor
    And I should see the "Orchestrate" text
