@apps @authenticated @core @mode-matrix
Feature: Workflow run and publish

  Scenario: Run and publish a minimal workflow app
    Given I am signed in as the default E2E admin
    And a "workflow" app has been created via API
    And a minimal runnable workflow draft has been synced
    When I open the app from the app list
    And I run the workflow
    Then the workflow run should succeed
    When I open the publish panel
    And I publish the app
    Then the app should be marked as published
