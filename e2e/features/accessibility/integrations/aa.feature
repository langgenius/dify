@accessibility @axe @wcag-aa @wcag-page-integrations @authenticated
Feature: Integrations page automated WCAG Level AA check
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  Scenario: Integrations page has no automatically detectable WCAG Level AA violations
    Given I am signed in as the default E2E admin
    When I open the "Integrations" main page
    Then I should be on the "Integrations" main page
    And the current page should have no automatically detectable WCAG Level AA violations
