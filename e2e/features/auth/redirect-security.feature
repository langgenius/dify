@auth @redirect-security
Feature: Safe sign-in redirects

  @authenticated
  Scenario: Ignore an external redirect target for an authenticated user
    Given I am signed in as the default E2E admin
    When I open the sign-in page with redirect target "https://google.com"
    Then I should be on the console home

  @unauthenticated
  Scenario: Ignore an external redirect target after signing in
    Given I am not signed in
    When I open the sign-in page with redirect target "https://google.com"
    And I sign in as the default E2E admin
    Then I should be on the console home
