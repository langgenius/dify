@apps @core
Feature: Use a shared workflow app

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
