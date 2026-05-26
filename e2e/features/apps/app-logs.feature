@apps @authenticated @core
Feature: App logs page

  Scenario: Navigate to the logs page of a workflow app
    Given I am signed in as the default E2E admin
    And a "workflow" app has been created via API
    When I navigate to the app logs page
    Then I should be on the app logs page
    And I should see the "Logs" text
