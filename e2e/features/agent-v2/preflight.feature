@agent-v2 @authenticated @infra @agent-v2-preflight
Feature: Agent Builder preseeded environment
  @agent-lifecycle
  Scenario: Agent lifecycle permissions are available
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And the Agent v2 composer draft uses the normal E2E prompt
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date

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

  @skill-fixture
  Scenario: Summary Skill package fixture uploads to Agent drive
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And the e2e-summary-skill Skill is available to the Agent v2 test agent
    Then the Agent v2 test agent should include drive skill "e2e-summary-skill"

  Scenario: Agent knowledge base is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded dataset "E2E Agent Knowledge Base" is indexed and ready

  Scenario: Indexing knowledge base is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded dataset "E2E Agent Knowledge Base Indexing" is indexing

  Scenario: Full config Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" is available

  Scenario: Full config Agent includes the summary Skill
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" includes drive skill "e2e-summary-skill"

  Scenario: Full config Agent includes core fixture configuration
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Full Config" includes the core fixture configuration

  Scenario: Tool states Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" is available

  Scenario: Tool states Agent includes tool state fixture configuration
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E New Agent Builder Tool States" includes the tool state fixture configuration

  Scenario: File tree Agent includes fixture files
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With File Tree" includes the file tree fixture files

  Scenario: Dual retrieval Agent is available
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With Dual Retrieval" is available

  Scenario: Dual retrieval Agent includes dual retrieval fixture configuration
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With Dual Retrieval" includes the dual retrieval fixture configuration

  Scenario: Published Web app Agent exposes Web app access
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent Published Web App" has published Web app access

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

  Scenario: Workflow reference Agent is used by the reference workflow
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded Agent "E2E Agent With Workflow Reference" is referenced by workflow "E2E Agent Reference Workflow"
