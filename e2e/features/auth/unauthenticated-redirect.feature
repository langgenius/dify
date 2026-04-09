@auth @unauthenticated
Feature: Unauthenticated redirect
  Scenario: Unauthenticated user is redirected to the sign-in page
    Given I am not signed in
    When I open the apps console
    Then I should be on the sign-in page
