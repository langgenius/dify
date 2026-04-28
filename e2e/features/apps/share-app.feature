@apps @authenticated @core
Feature: Share app publicly

  Scenario: Enable public share for a published workflow app
    Given I am signed in as the default E2E admin
    And a "workflow" app has been created via API
    And a minimal runnable workflow draft has been synced
    When I open the app from the app list
    And I open the publish panel
    And I publish the app
    And I navigate to the app overview page
    And I enable the Web App share
    Then the Web App should be in service

  @unauthenticated
  Scenario: Access a shared workflow app without authentication
    Given a workflow app has been published and shared via API
    When I open the shared app URL
    Then the shared app page should be accessible

  @unauthenticated
  Scenario: Run a shared workflow app without authentication
    Given a workflow app has been published and shared via API
    When I open the shared app URL
    And I run the shared workflow app
    Then the shared workflow run should succeed
