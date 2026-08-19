@apps @authenticated @core @mode-matrix
Feature: Create Workflow app
  Scenario: Create a new Workflow app and redirect to the workflow editor
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I start creating a blank app
    And I select the "Workflow" app type
    And I enter a unique E2E app name
    And I confirm app creation
    Then I should land on the workflow editor
