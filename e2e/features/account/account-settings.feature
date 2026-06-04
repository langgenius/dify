@account @authenticated @core
Feature: Account settings page
  Scenario: Open the account settings page and see user profile
    Given I am signed in as the default E2E admin
    When I open the account settings page
    Then I should see the "My Account" heading
    And I should see the account email address

  Scenario: Edit name button is visible on the account page
    Given I am signed in as the default E2E admin
    When I open the account settings page
    Then I should see the name edit button
