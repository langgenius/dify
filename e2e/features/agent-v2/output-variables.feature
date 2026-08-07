@agent-v2 @authenticated @output-variables
Feature: Agent v2 output variables
  @core @prepared @stable-model
  Scenario: Workflow Agent v2 output variables persist after refresh
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a workflow app with an Agent v2 node has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    And I add these Agent v2 workflow node output variables
      | name           | type          |
      | e2e_summary    | string        |
      | e2e_report_pdf | file          |
      | e2e_topics     | array[string] |
    Then the Agent v2 workflow node output variables should be saved in the workflow draft
    When I refresh the current page
    And I open the Agent v2 workflow node panel
    Then I should see the Agent v2 workflow node output variables

  @core @prepared @stable-model
  Scenario: Workflow Agent v2 nested object output variables persist after refresh
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a workflow app with an Agent v2 node has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    And I add a required Agent v2 workflow node object output variable with text and analysis fields
    Then the Agent v2 workflow node nested object output variable should be saved in the workflow draft
    When I refresh the current page
    And I open the Agent v2 workflow node panel
    Then I should see the Agent v2 workflow node nested object output variable

  @core @prepared @stable-model
  Scenario: Workflow Agent v2 prompt output reference stays synced when renamed
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a workflow app with an Agent v2 node has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    And I insert an output reference from the Agent v2 workflow node task editor
    Then the Agent v2 workflow node task should reference the output
    When I rename the Agent v2 workflow node task output reference
    Then the Agent v2 workflow node task should reference the renamed output
    When I refresh the current page
    And I open the Agent v2 workflow node panel
    Then the Agent v2 workflow node task should reference the renamed output
