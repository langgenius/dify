@accessibility @axe @unauthenticated
Feature: Sign-in page automated WCAG checks
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  Scenario Outline: Sign-in page has no automatically detectable WCAG Level <level> violations
    Given I am not signed in
    When I open the sign-in page
    Then I should see the "Sign in" button
    And the current page should have no automatically detectable WCAG Level <level> violations

    @wcag-a @wcag-page-sign-in
    Examples: Level A
      | level |
      | A     |

    @wcag-aa @wcag-page-sign-in
    Examples: Level AA
      | level |
      | AA    |
