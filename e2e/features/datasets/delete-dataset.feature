@datasets @authenticated
Feature: Delete dataset
  Scenario: Delete an existing dataset from the datasets page
    Given I am signed in as the default E2E admin
    And there is an existing E2E dataset available for testing
    When I open the datasets page
    And I open the operations menu for the last created E2E dataset
    And I click "Delete" in the dataset operations menu
    And I confirm the dataset deletion
    Then the dataset should no longer appear on the datasets page
