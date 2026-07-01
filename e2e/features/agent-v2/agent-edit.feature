@agent-v2 @authenticated @agent-edit @core
Feature: Agent v2 Agent Edit page
  Scenario: Tool states are visible on the Agent Edit page
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" includes the tool state fixture configuration
    When I open the preseeded Agent v2 configure page for "E2E New Agent Builder Tool States" from the Agent Roster
    Then I should see the Agent v2 tool state fixture tools
