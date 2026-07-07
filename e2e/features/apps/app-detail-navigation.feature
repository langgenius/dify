@apps @authenticated @core
Feature: App detail navigation

  Scenario: Opening a workflow app navigates to the workflow editor
    Given I am signed in as the default E2E admin
    And a "workflow" app has been created via API
    When I open the app from the app list
    Then I should land on the workflow editor

  Scenario: Opening a chatbot app navigates to the configuration page
    Given I am signed in as the default E2E admin
    And a "chat" app has been created via API
    When I open the app from the app list
    Then I should land on the app configuration page

  Scenario: The develop tab is accessible from a workflow app
    Given I am signed in as the default E2E admin
    And a "workflow" app has been created via API
    When I navigate to the app develop page
    Then I should be on the app develop page

  Scenario: The overview tab is accessible from a workflow app
    Given I am signed in as the default E2E admin
    And a "workflow" app has been created via API
    When I navigate to the app overview page
    Then I should be on the app overview page
