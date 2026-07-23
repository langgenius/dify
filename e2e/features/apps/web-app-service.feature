@apps @authenticated @core
Feature: Manage Web App service

  Scenario: Disable and restore a published workflow Web App
    Given I am signed in as the default E2E admin
    And a new runnable workflow app has been published
    When I navigate to the app overview page
    And I open the app information panel
    Then the Web App should be in service
    When an anonymous visitor opens the Web App
    Then the published workflow Web App should be accessible
    When I disable the Web App
    Then the Web App should be disabled
    When the anonymous visitor reloads the Web App
    Then the published workflow Web App should be unavailable
    When I enable the Web App
    Then the Web App should be in service
    When the anonymous visitor reloads the Web App
    Then the published workflow Web App should be accessible
