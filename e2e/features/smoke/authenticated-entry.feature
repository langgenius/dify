@smoke @authenticated
Feature: Authenticated console home
  Scenario: Open the default console entry with the shared authenticated state
    Given I am signed in as the default E2E admin
    When I open the default console entry
    Then I should be on the console home
    And I should not see the "Sign in" button
