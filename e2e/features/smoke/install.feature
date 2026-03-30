@smoke @fresh
Feature: Fresh installation bootstrap
  Scenario: Complete the initial installation bootstrap on a fresh instance
    Given the last authentication bootstrap came from a fresh install
    When I open the apps console
    Then I should stay on the apps console
    And I should see the "Create from Blank" button
