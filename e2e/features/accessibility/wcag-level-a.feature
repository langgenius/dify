@accessibility @axe
Feature: Automated WCAG Level A checks
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  @unauthenticated
  Scenario: Sign-in page has no automatically detectable WCAG Level A violations
    Given I am not signed in
    When I open the sign-in page
    Then I should see the "Sign in" button
    And the current page should have no automatically detectable WCAG Level A violations

  @authenticated
  Scenario: Apps console has no automatically detectable WCAG Level A violations
    Given I am signed in as the default E2E admin
    When I open the apps console
    Then I should stay on the apps console
    And the current page should have no automatically detectable WCAG Level A violations
