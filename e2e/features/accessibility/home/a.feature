@accessibility @axe @wcag-a @wcag-page-home @authenticated
Feature: Home page automated WCAG Level A check
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  Scenario: Home page has no automatically detectable WCAG Level A violations
    Given I am signed in as the default E2E admin
    When I open the "Home" main page
    Then I should be on the "Home" main page
    And the current page should have no automatically detectable WCAG Level A violations
