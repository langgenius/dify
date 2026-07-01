@agent-v2 @authenticated @infra @agent-v2-preflight
Feature: Agent Builder preseeded environment
  Scenario: Stable chat model is available
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available

  Scenario: Broken chat model is available for recovery scenarios
    Given I am signed in as the default E2E admin
    And the Agent Builder broken chat model is available

  Scenario: JSON Replace tool is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded tool "JSON Process / JSON Replace" is available

  Scenario: Tavily Search tool is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded tool "Tavily / Tavily Search" is available

  Scenario: Agent knowledge base is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded dataset "E2E Agent Knowledge Base" is available

  Scenario: Indexing knowledge base is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded dataset "E2E Agent Knowledge Base Indexing" is available

  Scenario: Full config Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" is available

  Scenario: Full config Agent includes the Summary Skill
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" includes drive skill "E2E Summary Skill"

  Scenario: Tool states Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" is available

  Scenario: File tree Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With File Tree" is available

  Scenario: Dual retrieval Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With Dual Retrieval" is available

  Scenario: Published Web app Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent Published Web App" is available

  Scenario: Backend API-enabled Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent Backend API Enabled" is available

  Scenario: Backend API-enabled Agent exposes API access with a key
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent Backend API Enabled" has Backend service API access with an API key

  Scenario: Workflow reference Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With Workflow Reference" is available

  Scenario: Reference workflow is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded workflow "E2E Agent Reference Workflow" is available
