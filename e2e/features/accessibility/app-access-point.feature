@accessibility @axe @authenticated
Feature: App access point automated WCAG checks
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  Scenario Outline: Unpublished <mode> access points have no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a "<mode>" app has been created via API
    When I navigate to the app access point page
    Then the app access point page should be ready
    And the current page should have no automatically detectable WCAG Level <level> violations

    @wcag-a @wcag-page-app-access-point
    Examples: Unpublished apps at Level A
      | mode          | level |
      | workflow      | A     |
      | advanced-chat | A     |
      | chat          | A     |
      | completion    | A     |

    @wcag-aa @wcag-page-app-access-point
    Examples: Unpublished apps at Level AA
      | mode          | level |
      | workflow      | AA    |
      | advanced-chat | AA    |
      | chat          | AA    |
      | completion    | AA    |

  Scenario Outline: Published workflow access points have no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a new runnable workflow app has been published
    When I navigate to the app access point page
    Then the app access point page should be ready
    And the current page should have no automatically detectable WCAG Level <level> violations

    @wcag-a @wcag-page-app-access-point
    Examples: Published workflow at Level A
      | level |
      | A     |

    @wcag-aa @wcag-page-app-access-point
    Examples: Published workflow at Level AA
      | level |
      | AA    |

  Scenario Outline: App access point <surface> has no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a new runnable workflow app has been published
    When I navigate to the app access point page
    Then the app access point page should be ready
    When I open the "<surface>" app access point dialog
    Then the "<surface>" app access point dialog should support keyboard focus and dismissal
    And the current page should have no automatically detectable WCAG Level <level> violations

    @wcag-a @wcag-page-app-access-point
    Examples: Dialogs at Level A
      | surface           | level |
      | API Key           | A     |
      | MCP configuration | A     |

    @wcag-aa @wcag-page-app-access-point
    Examples: Dialogs at Level AA
      | surface           | level |
      | API Key           | AA    |
      | MCP configuration | AA    |
