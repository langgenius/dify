@apps @authenticated @core
Feature: Publish app

  Scenario: Publish a workflow app for the first time
    Given I am signed in as the default E2E admin
    And a "workflow" app has been created via API
    And a minimal workflow draft has been synced
    When I open the app from the app list
    And I open the publish panel
    And I publish the app
    Then the app should be marked as published
