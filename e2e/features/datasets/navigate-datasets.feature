@datasets @authenticated @core
Feature: Navigate datasets
  Scenario: Open the datasets page and see the Knowledge list
    Given I am signed in as the default E2E admin
    When I open the datasets page
    Then I should stay on the datasets page
    And I should see the "Create Knowledge" link

  Scenario: Open the dataset creation page from the datasets list
    Given I am signed in as the default E2E admin
    When I open the datasets page
    And I click the "Create Knowledge" link
    Then I should be on the dataset creation page
