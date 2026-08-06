@accessibility @axe @wcag-aa
Feature: Automated WCAG Level AA checks
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  @unauthenticated
  Scenario: Sign-in page has no automatically detectable WCAG Level AA violations
    Given I am not signed in
    When I open the sign-in page
    Then I should see the "Sign in" button
    And the current page should have no automatically detectable WCAG Level AA violations

  @authenticated
  Scenario Outline: <page> main page has no automatically detectable WCAG Level AA violations
    Given I am signed in as the default E2E admin
    When I open the "<page>" main page
    Then I should be on the "<page>" main page
    And the current page should have no automatically detectable WCAG Level AA violations

    Examples:
      | page         |
      | Home         |
      | Studio       |
      | Agents       |
      | Knowledge    |
      | Integrations |
