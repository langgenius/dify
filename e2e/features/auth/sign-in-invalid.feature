@auth @unauthenticated
Feature: Sign in with invalid credentials
  Scenario: Attempt to sign in with wrong password and see an error
    Given I am not signed in
    When I open the sign-in page
    And I enter invalid credentials
    And I click the sign-in button
    Then I should see a sign-in error message
