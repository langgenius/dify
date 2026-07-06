@agent-v2 @authenticated @output-variables
Feature: Agent v2 output variables
  @standalone-output-variables @feature-gated
  Scenario: Standalone Agent configure exposes Output Variables
    Given I am signed in as the default E2E admin
    And Agent v2 standalone Output Variables are available
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 standalone Output Variables should be available

  @core @stable-model
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

  @core @stable-model
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

  @core @stable-model
  Scenario: Workflow Agent v2 prompt output reference stays synced when renamed
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a workflow app with an Agent v2 node has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    And I insert a file output reference from the Agent v2 workflow node task editor
    Then the Agent v2 workflow node task should reference the file output
    When I rename the Agent v2 workflow node task output reference
    Then the Agent v2 workflow node task should reference the renamed file output
    When I refresh the current page
    And I open the Agent v2 workflow node panel
    Then the Agent v2 workflow node task should reference the renamed file output

  @output-reference-delete @feature-gated @stable-model
  Scenario: Workflow Agent v2 prompt output reference deletion remains explicit
    Given I am signed in as the default E2E admin
    And Agent v2 workflow task output reference deletion consistency is available
    And the Agent Builder stable chat model is available
    And a workflow app with an Agent v2 node has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    And I insert a file output reference from the Agent v2 workflow node task editor
    Then Agent v2 workflow task output reference deletion consistency should be available

  @output-retry-strategy @feature-gated @stable-model
  Scenario: Workflow Agent v2 output retry strategy can be saved after refresh
    Given I am signed in as the default E2E admin
    And Agent v2 workflow output retry strategy is available
    And the Agent Builder stable chat model is available
    And a workflow app with an Agent v2 node has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    Then Agent v2 workflow output retry strategy should be available

  @output-retry-validation @feature-gated @stable-model
  Scenario: Workflow Agent v2 output retry count validation is enforced
    Given I am signed in as the default E2E admin
    And Agent v2 workflow output retry count validation is available
    And the Agent Builder stable chat model is available
    And a workflow app with an Agent v2 node has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    Then Agent v2 workflow output retry count validation should be available
