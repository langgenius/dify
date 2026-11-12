@evaluation @authenticated @core @community
Feature: Evaluation navigation in Community edition

  Scenario: A published workflow app does not offer Evaluation in Community edition
    Given I am signed in as the default E2E admin
    And a new runnable workflow app has been published
    When I open the app from the app list
    Then Evaluation is not offered from the resource details

  Scenario: A dataset does not offer Evaluation in Community edition
    Given I am signed in as the default E2E admin
    And a general dataset has been created via API
    When I open the dataset from the knowledge list
    Then Evaluation is not offered from the resource details
