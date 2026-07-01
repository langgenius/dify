@agent-v2 @authenticated @files @core
Feature: Agent v2 files
  Scenario: Uploading a small file keeps it in the Agent configuration
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I upload the small Agent v2 file from the Files section
    Then I should see the small Agent v2 file in the Files section
    And the small Agent v2 file should be saved in the Agent v2 draft
    When I refresh the current page
    Then I should see the small Agent v2 file in the Files section

  Scenario: Uploading a special-name file keeps the filename readable
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I upload the special-name Agent v2 file from the Files section
    Then I should see the special-name Agent v2 file in the Files section
    And the special-name Agent v2 file should be saved in the Agent v2 draft
    When I refresh the current page
    Then I should see the special-name Agent v2 file in the Files section
