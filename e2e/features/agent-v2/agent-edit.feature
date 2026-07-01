@agent-v2 @authenticated @agent-edit
Feature: Agent v2 Agent Edit page
  @core
  Scenario: Saved orchestration sections are visible on the Agent Edit page
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" includes the core fixture configuration
    When I open the preseeded Agent v2 configure page for "E2E New Agent Builder Full Config" from the Agent Roster
    Then I should see the Agent v2 full-config fixture sections

  @core
  Scenario: Duplicated Agent inherits configuration without changing the original Agent
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" includes the core fixture configuration
    When I duplicate the preseeded Agent v2 "E2E New Agent Builder Full Config" from the Agent Roster
    Then the duplicated Agent v2 should inherit the full-config fixture from "E2E New Agent Builder Full Config"
    When I open the Agent v2 configure page
    And I fill the Agent v2 prompt editor with the updated E2E prompt
    Then the Agent v2 configuration should be saved automatically
    And the normal Agent v2 draft should use the updated E2E prompt
    And the preseeded Agent v2 "E2E New Agent Builder Full Config" should still use the normal E2E prompt

  @core
  Scenario: Tool states are visible on the Agent Edit page
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" includes the tool state fixture configuration
    When I open the preseeded Agent v2 configure page for "E2E New Agent Builder Tool States" from the Agent Roster
    Then I should see the Agent v2 tool state fixture tools

  @tool-error-state @feature-gated
  Scenario: Tool credential error states are visible on the Agent Edit page
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" is available
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" includes the tool state fixture configuration
    When I open the preseeded Agent v2 configure page for "E2E New Agent Builder Tool States" from the Agent Roster
    Then Agent v2 Tool credential error state should be available

  @core
  Scenario: File fixture entries are visible in the current flat Files list
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With File Tree" is available
    And the Agent Builder preseeded Agent "E2E Agent With File Tree" includes the file tree fixture files
    And the Agent Builder preseeded Agent "E2E Agent With File Tree" includes the current flat file fixture configuration
    When I open the preseeded Agent v2 configure page for "E2E Agent With File Tree" from the Agent Roster
    Then I should see the Agent v2 file fixture entries in the current flat Files list

  @core
  Scenario: Dual Knowledge Retrieval settings are visible on the Agent Edit page
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With Dual Retrieval" is available
    And the Agent Builder preseeded Agent "E2E Agent With Dual Retrieval" includes the dual retrieval fixture configuration
    When I open the preseeded Agent v2 configure page for "E2E Agent With Dual Retrieval" from the Agent Roster
    Then I should see the Agent v2 dual retrieval fixture settings

  @core
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
