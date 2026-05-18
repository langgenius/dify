@datasets @authenticated
Feature: List datasets
  Scenario: View datasets list on the datasets page
    Given I am signed in as the default E2E admin
    And there is an existing E2E dataset available for testing
    When I open the datasets page
    Then I should see the dataset in the list
    And the dataset count should be at least 1
