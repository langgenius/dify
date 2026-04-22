@smoke @authenticated
Feature: Authenticated app console
  Scenario: Open the apps console with the shared authenticated state
    Given I am signed in as the default E2E admin
    When I open the apps console
    Then I should stay on the apps console
    And I should see the "Create from Blank" button
    And I should not see the "Sign in" button
