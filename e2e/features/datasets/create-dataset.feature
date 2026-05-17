@datasets @authenticated
Feature: Create dataset
  Scenario: Create a new empty dataset from the datasets page
    Given I am signed in as the default E2E admin
    When I open the datasets page
    And I click the create knowledge link
    And I click the empty knowledge creation option
    And I enter a unique E2E dataset name
    And I confirm empty dataset creation
    Then I should land on the dataset documents page
