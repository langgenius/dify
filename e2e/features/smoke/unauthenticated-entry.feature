@smoke @unauthenticated
Feature: Unauthenticated app console entry
  Scenario: Redirect to the sign-in page when opening the apps console without logging in
    Given I am not signed in
    When I open the apps console
    Then I should be redirected to the signin page
    And I should see the "Sign in" button
