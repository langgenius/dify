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
    Then the current page should have no automatically detectable WCAG Level <level> violations

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

  Scenario Outline: API Key creation and deletion dialogs have no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a new runnable workflow app has been published
    And the app has a secret key
    When I navigate to the app access point page
    Then the app access point page should be ready
    When I open the "API Key" app access point dialog
    Then the app API Key list should contain 1 key
    And the current page should have no automatically detectable WCAG Level <level> violations
    When I create a secret key from the app API Key dialog
    Then only the created API Key dialog should receive keyboard focus
    And the current page should have no automatically detectable WCAG Level <level> violations
    When I acknowledge the created app API Key
    Then the app API Key list should contain 2 keys
    When I request deletion of the first listed app API Key
    Then only the app API Key deletion dialog should receive keyboard focus
    And the current page should have no automatically detectable WCAG Level <level> violations
    When I cancel deletion of the app API Key
    Then the app API Key list should contain 2 keys
    When I request deletion of the first listed app API Key
    And I confirm deletion of the app API Key
    Then the app API Key list should contain 1 key
    And focus should return to the app API Key creation button

    @wcag-a @wcag-page-app-access-point
    Examples: API Key management at Level A
      | level |
      | A     |

    @wcag-aa @wcag-page-app-access-point
    Examples: API Key management at Level AA
      | level |
      | AA    |

  Scenario Outline: Web App settings <state> have no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a published chatflow app with hidden access point inputs
    When I navigate to the app access point page
    Then the app access point page should be ready
    When I open the "Web App settings" app access point dialog
    And I inspect the Web App settings "<state>"
    Then the current page should have no automatically detectable WCAG Level <level> violations

    @wcag-a @wcag-page-app-access-point
    Examples: Web App settings at Level A
      | state             | level |
      | form              | A     |
      | validation errors | A     |

    @wcag-aa @wcag-page-app-access-point
    Examples: Web App settings at Level AA
      | state             | level |
      | form              | AA    |
      | validation errors | AA    |

  Scenario Outline: Web App settings <state> popup has no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a published chatflow app with hidden access point inputs
    When I navigate to the app access point page
    Then the app access point page should be ready
    When I open the "Web App settings" app access point dialog
    And I inspect the Web App settings "<state>"
    Then the current page should have no automatically detectable WCAG Level <level> violations
    And the Web App settings "<state>" should restore focus after popup dismissal

    @wcag-a @wcag-page-app-access-point
    Examples: Web App settings popups at Level A
      | state            | level |
      | language options | A     |
      | icon picker      | A     |

    @wcag-aa @wcag-page-app-access-point
    Examples: Web App settings popups at Level AA
      | state            | level |
      | language options | AA    |
      | icon picker      | AA    |

  Scenario Outline: Chatflow embedding previews with hidden inputs have no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a published chatflow app with hidden access point inputs
    When I navigate to the app access point page
    Then the app access point page should be ready
    And the current page should have no automatically detectable WCAG Level <level> violations
    When I open the "Embedding" app access point dialog
    And I expand the embedding hidden input fields
    And I select the "iframe" embedding preview
    Then the selected embedding should expose its preview and copy action
    And the current page should have no automatically detectable WCAG Level <level> violations
    When I select the "scripts" embedding preview
    Then the selected embedding should expose its preview and copy action
    And the current page should have no automatically detectable WCAG Level <level> violations
    When I select the "Chrome extension" embedding preview
    Then the selected embedding should expose its preview and copy action
    And the current page should have no automatically detectable WCAG Level <level> violations

    @wcag-a @wcag-page-app-access-point
    Examples: Embedding at Level A
      | level |
      | A     |

    @wcag-aa @wcag-page-app-access-point
    Examples: Embedding at Level AA
      | level |
      | AA    |

  Scenario Outline: Workflow hidden input configuration has no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a published workflow app with hidden access point inputs
    When I navigate to the app access point page
    Then the app access point page should be ready
    When I open the "Workflow hidden inputs" app access point dialog
    And I fill the app access point hidden input form
    Then the current page should have no automatically detectable WCAG Level <level> violations
    When I open the hidden input language options
    Then the current page should have no automatically detectable WCAG Level <level> violations
    And the hidden input language options should dismiss back to the configuration dialog

    @wcag-a @wcag-page-app-access-point
    Examples: Workflow hidden inputs at Level A
      | level |
      | A     |

    @wcag-aa @wcag-page-app-access-point
    Examples: Workflow hidden inputs at Level AA
      | level |
      | AA    |

  Scenario Outline: Configured MCP parameter descriptions have no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    And a published workflow app with hidden access point inputs
    And the app has a configured MCP server with parameter descriptions
    When I navigate to the app access point page
    Then the app access point page should be ready
    When I open the "MCP description" app access point dialog
    Then the configured MCP parameter descriptions should be labelled and populated
    And the current page should have no automatically detectable WCAG Level <level> violations

    @wcag-a @wcag-page-app-access-point
    Examples: Configured MCP at Level A
      | level |
      | A     |

    @wcag-aa @wcag-page-app-access-point
    Examples: Configured MCP at Level AA
      | level |
      | AA    |
