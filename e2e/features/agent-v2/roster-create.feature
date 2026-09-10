@agent-v2 @authenticated @agent-create @core
Feature: Agent v2 Roster creation
  Scenario: Create an Agent from the Agent Roster
    Given I am signed in as the default E2E admin
    When I create an Agent v2 test agent from the Agent Roster
    Then the created Agent v2 should open in Configure
    And I should see the Agent v2 configure workspace
