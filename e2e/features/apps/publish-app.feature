@apps @authenticated @core
Feature: Publish app

  Scenario: Publish a chatbot app for the first time
    Given I am signed in as the default E2E admin
    And a "chat" app has been created via API
    When I open the app from the app list
    And I open the publish panel
    And I publish the app
    Then the app should be marked as published
