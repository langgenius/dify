@agent-v2 @authenticated @tools @core
Feature: Agent v2 tools
  Scenario: Tool selector shows an empty state for a missing tool search
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I search for the missing Agent v2 tool from the Tools selector
    Then I should see the Agent v2 tool selector empty state
    When I clear the Agent v2 tool selector search
    Then I should see the Agent v2 tool selector ready for another search
