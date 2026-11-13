@workflows @authenticated @core
Feature: Published workflow version isolation
  Scenario: Visitors receive draft changes only after the author publishes an update
    Given a template workflow returning "E2EPublishedResult" has been published
    When an anonymous visitor opens the Web App
    And the anonymous visitor executes the published template workflow
    Then the published template workflow should return "E2EPublishedResult"
    When I open the app from the app list
    And I change the workflow result template to "E2EUpdatedResult"
    Then the workflow result template should be saved as "E2EUpdatedResult"
    When the anonymous visitor executes the published template workflow
    Then the published template workflow should return "E2EPublishedResult"
    When I publish the workflow update
    And the anonymous visitor executes the published template workflow
    Then the published template workflow should return "E2EUpdatedResult"
