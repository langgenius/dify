@agent-v2 @authenticated @publish @core
Feature: Agent v2 publish
  Scenario: Publish a configured Agent v2 draft
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And the Agent v2 composer draft uses the normal E2E prompt
    When I open the Agent v2 configure page
    And I publish the Agent v2 draft
    Then the Agent v2 draft should be published and up to date
