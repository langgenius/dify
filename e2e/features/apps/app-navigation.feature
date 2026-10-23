@apps @authenticated
Feature: App navigation
  Scenario: Navigate between app tabs without full page reload
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I start creating a blank app
    And I enter a unique E2E app name
    And I confirm app creation
    Then I should land on the app editor
    And I should see the "Orchestrate" text
    When I click the monitoring tab
    Then I should see the monitoring page content
    When I click the orchestrate tab
    Then I should see the "Orchestrate" text
