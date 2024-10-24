Feature: Studio
  As a user
  I want to see all my apps in the studio
  So that I can access them easily

  @cleanSetup @difyInstalled @loggedIn
  Scenario: Visit Studio page on clean setup
    Given I am on the "/apps" page
    Then The nav item "/apps" should be active
