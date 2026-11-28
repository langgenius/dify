@auth @core @unauthenticated
Feature: Workspace invitation

  Scenario: A newly invited person creates an account and joins the workspace
    Given the default E2E admin has invited a person without an account
    When I open the workspace invitation
    Then I should be asked to create an account
    When I create my account with a new password
    And I set my name and join the workspace
    Then I should be on the console home

  Scenario: An invited person with an existing account signs in and joins the workspace
    Given the default E2E admin has invited a person who already has an account
    When I open the workspace invitation
    Then I should be asked to sign in
    When I sign in with my existing password
    And I join the workspace
    Then I should be on the console home
