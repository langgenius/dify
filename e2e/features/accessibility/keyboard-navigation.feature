@accessibility @keyboard @browser-smoke
Feature: Keyboard navigation

  @authenticated
  Scenario: Skip repeated navigation and move focus to the main content
    Given I am signed in as the default E2E admin
    When I open the default console entry
    And I focus and activate the skip navigation link with the keyboard
    Then the console main content should have keyboard focus

  @unauthenticated
  Scenario: Sign in by following the form tab order
    Given I am not signed in
    When I open the sign-in page
    And I complete the sign-in form using only the keyboard
    Then I should be on the console home

  @authenticated
  Scenario: Closing the account menu restores focus to its trigger
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I open and close the account menu using the keyboard
    Then the account menu trigger should regain keyboard focus

  @authenticated
  Scenario: Closing the create app menu restores focus to its trigger
    Given I am signed in as the default E2E admin
    When I open the apps console
    And I open and close the create app menu using the keyboard
    Then the create app menu trigger should regain keyboard focus
