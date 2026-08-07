@accessibility @axe @wcag-a @wcag-page-agents @authenticated
Feature: Agents page automated WCAG Level A check
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  Scenario: Agents page has no automatically detectable WCAG Level A violations
    Given I am signed in as the default E2E admin
    When I open the "Agents" main page
    Then I should be on the "Agents" main page
    And the current page should have no automatically detectable WCAG Level A violations
