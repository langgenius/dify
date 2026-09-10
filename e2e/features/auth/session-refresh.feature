@auth @core @authenticated
Feature: Console session refresh

  Scenario: Refresh the console session during server-side navigation
    Given I am signed in as the default E2E admin
    And my console session requires token refresh
    When I open the default console entry after the access token expires
    Then I should be on the console home
    And I should not see the "Sign in" button
