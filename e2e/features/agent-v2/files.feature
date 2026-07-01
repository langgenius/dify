@agent-v2 @authenticated @files
Feature: Agent v2 files
  @core
  Scenario: Uploading a small file keeps it in the Agent configuration
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I upload the small Agent v2 file from the Files section
    Then I should see the small Agent v2 file in the Files section
    And the small Agent v2 file should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the small Agent v2 file in the Files section

  @core
  Scenario: Uploading an empty file keeps a zero-byte file in the Agent configuration
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I upload the empty Agent v2 file from the Files section
    Then I should see the empty Agent v2 file in the Files section
    And the empty Agent v2 file should be saved as a zero-byte file in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the empty Agent v2 file in the Files section

  @core
  Scenario: Uploading a special-name file keeps the filename readable
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I upload the special-name Agent v2 file from the Files section
    Then I should see the special-name Agent v2 file in the Files section
    And the special-name Agent v2 file should be saved in the Agent v2 draft
    And the Agent v2 configuration should be saved automatically
    When I refresh the current page
    Then I should see the special-name Agent v2 file in the Files section

  @files-limits @feature-gated
  Scenario: Unsupported Agent v2 file formats show a clear rejection reason
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 unsupported file format rejection should be available

  @files-limits @feature-gated
  Scenario: Oversized Agent v2 files show a clear rejection reason
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 oversized file rejection should be available

  @files-limits @feature-gated
  Scenario: Agent v2 single-batch file count limits are enforced
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 single-batch file count limits should be available

  @files-limits @feature-gated
  Scenario: Agent v2 total file count limits are enforced
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 total file count limits should be available

  @files-limits @feature-gated
  Scenario: Leaving during Agent v2 file upload keeps a recoverable state
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 in-progress file upload recovery should be available
