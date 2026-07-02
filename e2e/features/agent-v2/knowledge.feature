@agent-v2 @authenticated @knowledge @knowledge-fixture
Feature: Agent v2 Knowledge Retrieval
  @core
  Scenario: Agent decide Knowledge Retrieval settings are saved and restored
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded dataset "E2E Agent Knowledge Base" is indexed and ready
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I add the Agent Builder knowledge base as an Agent decide Knowledge Retrieval
    Then the Agent v2 Agent decide Knowledge Retrieval should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the Agent v2 Agent decide Knowledge Retrieval settings

  @core
  Scenario: Custom query Knowledge Retrieval settings are saved and restored
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded dataset "E2E Agent Knowledge Base" is indexed and ready
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I add the Agent Builder knowledge base as a Custom query Knowledge Retrieval
    Then the Agent v2 Custom query Knowledge Retrieval should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the Agent v2 Custom query Knowledge Retrieval settings

  @service-api-runtime @stable-model @backend-api-access
  Scenario: Agent decide Knowledge Retrieval answers through Backend service API
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent Builder preseeded dataset "E2E Agent Knowledge Base" is indexed and ready
    And a runnable Agent v2 test agent has been created via API
    And Agent v2 Backend service API access has been enabled with a key via API
    When I open the Agent v2 configure page
    And I add the Agent Builder knowledge base as an Agent decide Knowledge Retrieval
    Then the Agent v2 Agent decide Knowledge Retrieval should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I send the Agent v2 Backend service API knowledge request
    Then the Agent v2 Backend service API response should include the knowledge E2E marker

  @service-api-runtime @stable-model @backend-api-access
  Scenario: Custom query Knowledge Retrieval answers through Backend service API
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent Builder preseeded dataset "E2E Agent Knowledge Base" is indexed and ready
    And a runnable Agent v2 test agent has been created via API
    And Agent v2 Backend service API access has been enabled with a key via API
    When I open the Agent v2 configure page
    And I add the Agent Builder knowledge base as a Custom query Knowledge Retrieval
    Then the Agent v2 Custom query Knowledge Retrieval should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I send the Agent v2 Backend service API knowledge request
    Then the Agent v2 Backend service API response should include the knowledge E2E marker

  @core
  Scenario: Removing Knowledge Retrieval clears the saved dataset reference
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded dataset "E2E Agent Knowledge Base" is indexed and ready
    And a knowledge-backed Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Knowledge Retrieval "Retrieval 1"
    When I remove the Agent v2 Knowledge Retrieval "Retrieval 1"
    Then the Agent v2 configuration should be saved automatically
    And the Agent v2 draft should no longer reference the Agent Builder knowledge base
    And I should not see the Agent v2 Knowledge Retrieval "Retrieval 1"
