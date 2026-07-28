@agent-v2 @authenticated @agent-edit
Feature: Agent v2 Agent Edit page
  @core @prepared @stable-model @full-config-agent
  Scenario: Saved orchestration sections are visible on the Agent Edit page
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" includes the core fixture configuration
    When I open the preseeded Agent v2 configure page for "E2E New Agent Builder Full Config" from the Agent Roster
    Then I should see the Agent v2 full-config fixture sections

  @core @prepared @stable-model @full-config-agent
  Scenario: Duplicated Agent inherits configuration without changing the original Agent
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" includes the core fixture configuration
    And the preseeded Agent v2 "E2E New Agent Builder Full Config" has been published via API
    When I duplicate the preseeded Agent v2 "E2E New Agent Builder Full Config" from the Agent Roster
    Then the duplicated Agent v2 should inherit the full-config fixture from "E2E New Agent Builder Full Config"
    When I open the Agent v2 configure page
    And I fill the Agent v2 prompt editor with the updated E2E prompt
    Then the Agent v2 configuration should be saved automatically
    And the normal Agent v2 draft should use the updated E2E prompt
    And the preseeded Agent v2 "E2E New Agent Builder Full Config" should still use the normal E2E prompt

  @core @prepared @tool-states-agent
  Scenario: Tool states are visible on the Agent Edit page
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" includes the tool state fixture configuration
    When I open the preseeded Agent v2 configure page for "E2E New Agent Builder Tool States" from the Agent Roster
    Then I should see the Agent v2 tool state fixture tools

  @core @prepared @dual-retrieval-fixture
  Scenario: Dual Knowledge Retrieval settings are visible on the Agent Edit page
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With Dual Retrieval" is available
    And the Agent Builder preseeded Agent "E2E Agent With Dual Retrieval" includes the dual retrieval fixture configuration
    When I open the preseeded Agent v2 configure page for "E2E Agent With Dual Retrieval" from the Agent Roster
    Then I should see the Agent v2 dual retrieval fixture settings

  @core @prepared @stable-model
  Scenario: Agent Edit opens the same Agent in Agent Console
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a workflow app with an Agent v2 node has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    And I open the Agent v2 workflow Agent details
    Then I should see the Agent v2 workflow Agent details for the created Agent
    When I open the Agent v2 workflow Agent in Agent Console
    Then the Agent v2 Agent Console should open for the same workflow Agent
