@auth @smoke @core @unauthenticated
Feature: Sign in

  Scenario: Sign in with valid credentials and reach the apps console
    Given I am not signed in
    When I open the sign-in page
    And I sign in as the default E2E admin
    Then I should be on the apps console
