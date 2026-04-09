@auth @authenticated
Feature: Sign out
  Scenario: Sign out from the apps console
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I open the account menu
    And I sign out
    Then I should be on the sign-in page
