@smoke @unauthenticated
Feature: Unauthenticated console home entry
  Scenario: Redirect to the sign-in page when opening the default console entry without logging in
    Given I am not signed in
    When I open the default console entry
    Then I should be redirected to the signin page
    And I should see the "Sign in" button
