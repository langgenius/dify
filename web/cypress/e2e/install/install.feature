Feature: Install
  As a user
  I want to complete the installation
  So that I can start using the application

  @cleanSetup
  Scenario: Create admin account to complete installation
    Given I am on the "/install" page
    When I enter valid form data
    And I click the "install-button"
    Then I should be redirected to "/signin"

  @cleanSetup
  Scenario: Admin account already created
    Given I am on the "/install" page
    And I have created an admin account
    Then I should be redirected to "/signin"
