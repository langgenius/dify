@agent-v2 @authenticated @advanced-settings
Feature: Agent v2 advanced settings
  @core
  Scenario: Advanced Settings exposes supported configuration entries
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 Advanced Settings should describe supported entries while collapsed
    When I expand Agent v2 Advanced Settings
    Then I should see the supported Agent v2 Advanced Settings entries
    When I collapse Agent v2 Advanced Settings
    Then Agent v2 Advanced Settings should describe supported entries while collapsed

  @core
  Scenario: Plain environment variables are saved and restored
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I add the plain Agent v2 environment variable from Advanced Settings
    Then the plain Agent v2 environment variable should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the plain Agent v2 environment variable in Advanced Settings

  @core
  Scenario: Valid environment imports are saved and restored
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I import the valid Agent v2 environment file from Advanced Settings
    Then the valid Agent v2 environment import should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the Agent v2 environment variables from the valid import in Advanced Settings

  @core
  Scenario: Deleted environment variables are removed after refresh
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I add the plain Agent v2 environment variable from Advanced Settings
    And I add the secondary plain Agent v2 environment variable from Advanced Settings
    Then the Agent v2 environment variables for deletion should be saved in the Agent v2 draft
    When I delete the plain Agent v2 environment variable from Advanced Settings
    Then the plain Agent v2 environment variable should be removed from the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should not see the deleted Agent v2 environment variable in Advanced Settings

  @core
  Scenario: Invalid environment imports report skipped lines and keep existing variables
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I add the plain Agent v2 environment variable from Advanced Settings
    Then the plain Agent v2 environment variable should be saved in the Agent v2 draft
    When I import the invalid Agent v2 environment file from Advanced Settings
    Then the invalid Agent v2 environment import should report skipped lines
    And the Agent v2 environment variables from the invalid import should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the Agent v2 environment variables from the invalid import in Advanced Settings

  @content-moderation @feature-gated
  Scenario: Content Moderation keyword preset replies are saved and restored
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I expand Agent v2 Advanced Settings
    Then Agent v2 Content Moderation Settings should be available
    When I configure Agent v2 Content Moderation keyword preset replies
    Then Agent v2 Content Moderation keyword preset replies should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    And I expand Agent v2 Advanced Settings
    Then I should see the Agent v2 Content Moderation keyword preset replies in Advanced Settings
