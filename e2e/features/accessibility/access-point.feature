@accessibility @axe @authenticated
Feature: Access Point automated WCAG checks
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  Scenario Outline: An unpublished Access Point has no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a "workflow" app has been created via API
    When I navigate to the app access point page
    Then the Access Point page should be ready
    And the current page should have no automatically detectable WCAG Level <level> violations

    @wcag-a @wcag-page-access-point
    Examples: Unpublished at Level A
      | level |
      | A     |

    @wcag-aa @wcag-page-access-point
    Examples: Unpublished at Level AA
      | level |
      | AA    |

  Scenario Outline: A published workflow Access Point and its dialogs have no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a new runnable workflow app has been published
    When I navigate to the app access point page
    Then the Access Point page should be ready
    And the current page should have no automatically detectable WCAG Level <level> violations
    When I open the "Branding" Access Point dialog
    Then the current page should have no automatically detectable WCAG Level <level> violations
    When I dismiss the "Branding" Access Point dialog with Escape
    Then focus should return to the "Branding" Access Point entry
    When I open the "Add description to enable MCP server" Access Point dialog
    Then the current page should have no automatically detectable WCAG Level <level> violations
    When I dismiss the "Add description to enable MCP server" Access Point dialog with Escape
    Then focus should return to the "Add description to enable MCP server" Access Point entry

    @wcag-a @wcag-page-access-point
    Examples: Published at Level A
      | level |
      | A     |

    @wcag-aa @wcag-page-access-point
    Examples: Published at Level AA
      | level |
      | AA    |

  Scenario Outline: A published chatflow Access Point and its dialogs have no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a new runnable chatflow app has been published
    When I navigate to the app access point page
    Then the Access Point page should be ready
    And the current page should have no automatically detectable WCAG Level <level> violations
    When I open the "Branding" Access Point dialog
    Then the current page should have no automatically detectable WCAG Level <level> violations
    When I dismiss the "Branding" Access Point dialog with Escape
    Then focus should return to the "Branding" Access Point entry
    When I open the "Embed on website" Access Point dialog
    Then the current page should have no automatically detectable WCAG Level <level> violations
    When I dismiss the "Embed on website" Access Point dialog with Escape
    Then focus should return to the "Embed on website" Access Point entry
    When I open the "Add description to enable MCP server" Access Point dialog
    Then the current page should have no automatically detectable WCAG Level <level> violations
    When I dismiss the "Add description to enable MCP server" Access Point dialog with Escape
    Then focus should return to the "Add description to enable MCP server" Access Point entry

    @wcag-a @wcag-page-access-point
    Examples: Chatflow at Level A
      | level |
      | A     |

    @wcag-aa @wcag-page-access-point
    Examples: Chatflow at Level AA
      | level |
      | AA    |
