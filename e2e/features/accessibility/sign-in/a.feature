@accessibility @axe @wcag-a @wcag-page-sign-in @unauthenticated
Feature: Sign-in page automated WCAG Level A check
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  Scenario: Sign-in page has no automatically detectable WCAG Level A violations
    Given I am not signed in
    When I open the sign-in page
    Then I should see the "Sign in" button
    And the current page should have no automatically detectable WCAG Level A violations
