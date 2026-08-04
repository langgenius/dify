@marketplace-performance
Feature: Embedded Marketplace performance budget
  Scenario: The first Marketplace collection stays within the initial rendering budget
    When I measure the embedded Marketplace under Fast 4G and 4x CPU throttling
    Then the embedded Marketplace should meet its initial rendering budgets
