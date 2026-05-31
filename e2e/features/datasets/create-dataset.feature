@datasets @authenticated @core
Feature: Create dataset
  Scenario: Create a new empty dataset
    Given I am signed in as the default E2E admin
    When I open the datasets page
    And I start creating a new dataset
    And I select "Create an empty Knowledge"
    And I enter a unique E2E dataset name
    And I confirm dataset creation
    Then I should land on the dataset document page
