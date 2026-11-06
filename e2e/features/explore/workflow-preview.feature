@workflow-preview @agent-v2 @authenticated @cloud-catalog-runtime
Feature: Workflow template orchestration preview
  Scenario: A routed Agent displays its successful and failure connections in the template preview
    Given I am signed in as the default E2E admin
    And the Cloud catalog contains a published workflow with Agent output routes and a failure branch
    When I open the routed workflow template orchestration details
    Then the template preview should show each Agent output route and its connection alongside the failure branch
