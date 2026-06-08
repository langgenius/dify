@auth @authenticated @core
Feature: Sign out
  Scenario: Sign out from the apps console
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I open the account menu
    And I sign out
    Then I should be on the sign-in page

  Scenario: Redirect back to sign-in when reopening the apps console after signing out
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I open the account menu
    And I sign out
    Then I should be on the sign-in page
    When I open the apps console
    Then I should be redirected to the signin page
    And I should see the "Sign in" button
