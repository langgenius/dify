@apps @authenticated @core @mode-matrix
Feature: Workflow run

  Scenario: Run a minimal workflow app
    Given I am signed in as the default E2E admin
    And a "workflow" app has been created via API
    And a minimal runnable workflow draft has been synced
    When I open the app from the app list
    And I run the workflow
    Then the workflow run should succeed
