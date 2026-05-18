@datasets @authenticated
Feature: Update dataset
  Scenario: Rename an existing dataset from the datasets page
    Given I am signed in as the default E2E admin
    And there is an existing E2E dataset available for testing
    When I open the datasets page
    And I open the operations menu for the last created E2E dataset
    And I click "Rename" in the dataset operations menu
    And I enter a new dataset name
    And I confirm the dataset rename
    Then the dataset should display the new name on the datasets page
