@agent-v2 @authenticated @knowledge @core
Feature: Agent v2 Knowledge Retrieval
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
