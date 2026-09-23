@evaluation @authenticated @core
Feature: Evaluation workspaces

  Scenario: Inspect a published workflow app evaluation workspace
    Given I am signed in as the default E2E admin
    And a new runnable workflow app has been published
    When I open the app from the app list
    And I open Evaluation from the resource details
    Then the workflow app evaluation workspace should be ready
    When I download the evaluation XLSX template
    Then an evaluation template named "workflow-evaluation-template.xlsx" should be downloaded
    When I open the evaluation test history
    Then the evaluation history should be empty

  Scenario: Inspect a dataset evaluation workspace
    Given I am signed in as the default E2E admin
    And a general dataset has been created via API
    When I open the dataset from the knowledge list
    And I open Evaluation from the resource details
    Then the dataset evaluation workspace should be ready
    When I download the evaluation XLSX template
    Then an evaluation template named "dataset-evaluation-template.xlsx" should be downloaded
