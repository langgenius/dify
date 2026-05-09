@datasets @authenticated @core
Feature: Create knowledge base dataset

  Scenario: Create a new empty dataset
    Given I am signed in as the default E2E admin
    When I navigate to the datasets page
    And I click the "Create Dataset" button
    And I select the "Create from text" option
    And I enter a unique E2E dataset name
    And I confirm dataset creation
    Then I should land on the dataset documents page
    And I should see the dataset name in the header

  Scenario: Navigate to datasets page from the sidebar
    Given I am signed in as the default E2E admin
    When I click the "Knowledge" link in the sidebar
    Then I should be on the datasets page
    And I should see the "Create Dataset" button
