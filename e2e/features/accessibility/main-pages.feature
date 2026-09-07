@accessibility @axe @authenticated
Feature: Main page automated WCAG checks
  Axe checks only automatically detectable issues and does not establish WCAG conformance.

  Scenario Outline: <page> page has no automatically detectable WCAG Level <level> violations
    Given I am signed in as the default E2E admin
    When I open the "<page>" main page
    Then I should be on the "<page>" main page
    And the current page should have no automatically detectable WCAG Level <level> violations

    @wcag-a @wcag-page-agents
    Examples: Agents at Level A
      | page   | level |
      | Agents | A     |

    @wcag-aa @wcag-page-agents
    Examples: Agents at Level AA
      | page   | level |
      | Agents | AA    |

    @wcag-a @wcag-page-home
    Examples: Home at Level A
      | page | level |
      | Home | A     |

    @wcag-aa @wcag-page-home
    Examples: Home at Level AA
      | page | level |
      | Home | AA    |

    @wcag-a @wcag-page-integrations
    Examples: Integrations at Level A
      | page         | level |
      | Integrations | A     |

    @wcag-aa @wcag-page-integrations
    Examples: Integrations at Level AA
      | page         | level |
      | Integrations | AA    |

    @wcag-a @wcag-page-knowledge
    Examples: Knowledge at Level A
      | page      | level |
      | Knowledge | A     |

    @wcag-aa @wcag-page-knowledge
    Examples: Knowledge at Level AA
      | page      | level |
      | Knowledge | AA    |

    @wcag-a @wcag-page-studio
    Examples: Studio at Level A
      | page   | level |
      | Studio | A     |

    @wcag-aa @wcag-page-studio
    Examples: Studio at Level AA
      | page   | level |
      | Studio | AA    |
