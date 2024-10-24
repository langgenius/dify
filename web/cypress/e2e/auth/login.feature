Feature: Login
  As a user
  I  want to be able to login
  So that I can access my account

  @cleanSetup
  Scenario: Successful signin with username and password
    Given I am on the "/signin" page
    And I have created an admin account
    When I enter valid credentials
    And I click the "login-button"
    Then I should be redirected to "/apps"

  @cleanSetup @expectError
  Scenario Outline: Unsuccessful signin with username and password
    Given I am on the "/signin" page
    And I have created an admin account
    When I enter invalid credentials
    And I click the "login-button"
    Then I should see a toast "error" message
    And I should stay on page "/signin"
