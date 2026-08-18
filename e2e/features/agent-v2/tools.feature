@agent-v2 @authenticated @tools
Feature: Agent v2 tools
  @core @prepared @tool-fixture
  Scenario: JSON Replace tool is saved after adding it from the Tools selector
    Given I am signed in as the default E2E admin
    And the Agent Builder preseeded tool "JSON Process / JSON Replace" is available
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I add the Agent Builder JSON Replace tool from the Tools selector
    Then the Agent v2 JSON Replace tool should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the Agent v2 JSON Replace tool in the Tools section

  @service-api-runtime @external-model @agent-backend-runtime @stable-model @tool-fixture
  Scenario: JSON Replace tool runtime returns the replacement marker
    Given I am signed in as the default E2E admin
    And the Agent v2 runtime backend is available
    And the Agent Builder stable chat model is available
    And the Agent Builder preseeded tool "JSON Process / JSON Replace" is available
    And a runnable Agent v2 test agent with the JSON Replace tool has been created via API
    And Agent v2 Backend service API access has been enabled with a key via API
    When I open the Agent v2 configure page
    Then the Agent v2 JSON Replace tool should be saved in the Agent v2 draft
    When I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
    When I send the Agent v2 Backend service API JSON Replace request
    Then the Agent v2 Backend service API response should include the JSON Replace E2E marker

  @core
  Scenario: Tool selector shows an empty state for a missing tool search
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I search for the missing Agent v2 tool from the Tools selector
    Then I should see the Agent v2 tool selector empty state
    When I clear the Agent v2 tool selector search
    Then I should see the Agent v2 tool selector ready for another search
