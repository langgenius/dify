@agent-v2 @authenticated @build
Feature: Agent v2 build draft
  @core
  Scenario: Generating a Build draft leaves the normal Agent configuration unchanged
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And the Agent Builder preseeded tool "JSON Process / JSON Replace" is available
    And a runnable Agent v2 test agent has been created via API
    And the e2e-summary-skill Skill is available to the Agent v2 test agent
    When I open the Agent v2 configure page
    And I generate an Agent v2 Build draft from the fixed instruction
    Then I should see the Agent v2 Build draft pending changes
    And I should see the Agent v2 Build mode confirmation state
    And the normal Agent v2 draft should still use the normal E2E prompt
    And the normal Agent v2 draft should not include the Agent Builder JSON Replace tool

  @core
  Scenario: Discarding a Build draft keeps the original Agent configuration
    Given I am signed in as the default E2E admin
    And an Agent v2 test agent has been created via API
    And the Agent v2 composer draft uses the normal E2E prompt
    And an Agent v2 Build draft uses the updated E2E prompt
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Build draft pending changes
    And I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should still use the normal E2E prompt
    When I discard the Agent v2 Build draft
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And the Agent v2 Build draft should no longer be active
    When I refresh the current page
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And the Agent v2 Build draft should no longer be active

  @core
  Scenario: Discarding a Build draft does not apply supported configuration changes
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    And an Agent v2 Build draft adds the supported E2E files, skills, and env
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Build draft pending changes
    And I should see the small Agent v2 file in the Files section
    And I should see the e2e-summary-skill Skill in the Skills section
    And I should see the supported E2E environment variable in Advanced Settings
    And the normal Agent v2 draft should still use the normal E2E prompt
    When I discard the Agent v2 Build draft
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And I should not see the small Agent v2 file in the Files section
    And I should not see the e2e-summary-skill Skill in the Skills section
    And I should not see the supported E2E environment variable in Advanced Settings
    And the Agent v2 draft should not include the supported Build draft config
    And the Agent v2 Build draft should no longer be active
    When I refresh the current page
    Then I should see the normal E2E prompt in the Agent v2 prompt editor
    And I should not see the small Agent v2 file in the Files section
    And I should not see the e2e-summary-skill Skill in the Skills section
    And I should not see the supported E2E environment variable in Advanced Settings
    And the Agent v2 draft should not include the supported Build draft config
    And the Agent v2 Build draft should no longer be active

  @core
  Scenario: Applying a pending Build draft updates the normal Agent configuration
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    And an Agent v2 Build draft uses the updated E2E prompt with the stable E2E model
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Build draft pending changes
    And I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should still use the normal E2E prompt
    When I apply the Agent v2 Build draft
    Then I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should use the updated E2E prompt
    And the Agent v2 Build draft should no longer be active
    When I refresh the current page
    Then I should see the updated E2E prompt in the Agent v2 prompt editor
    And the Agent v2 Build draft should no longer be active

  @core
  Scenario: Applying a Build draft updates supported configuration sections
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    And an Agent v2 Build draft adds the supported E2E files, skills, and env
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Build draft pending changes
    And I should see the updated E2E prompt in the Agent v2 prompt editor
    And I should see the small Agent v2 file in the Files section
    And I should see the e2e-summary-skill Skill in the Skills section
    And I should see the supported E2E environment variable in Advanced Settings
    And the normal Agent v2 draft should still use the normal E2E prompt
    When I apply the Agent v2 Build draft
    Then I should see the updated E2E prompt in the Agent v2 prompt editor
    And I should see the small Agent v2 file in the Files section
    And I should see the e2e-summary-skill Skill in the Skills section
    And I should see the supported E2E environment variable in Advanced Settings
    And the Agent v2 draft should include the supported Build draft config
    And the Agent v2 Build draft should no longer be active
    When I refresh the current page
    Then I should see the updated E2E prompt in the Agent v2 prompt editor
    And I should see the small Agent v2 file in the Files section
    And I should see the e2e-summary-skill Skill in the Skills section
    And I should see the supported E2E environment variable in Advanced Settings
    And the Agent v2 Build draft should no longer be active

  @core
  Scenario: Applying a Build draft with an existing Skill keeps a single Skill entry
    Given I am signed in as the default E2E admin
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    And an Agent v2 Build draft includes the existing e2e-summary-skill Skill
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Build draft pending changes
    And I should see one e2e-summary-skill Skill in the Skills section
    And the Agent v2 draft should include one e2e-summary-skill Skill
    When I apply the Agent v2 Build draft
    Then I should see one e2e-summary-skill Skill in the Skills section
    And the Agent v2 draft should include one e2e-summary-skill Skill
    And the Agent v2 Build draft should no longer be active
    When I refresh the current page
    Then I should see one e2e-summary-skill Skill in the Skills section
    And the Agent v2 draft should include one e2e-summary-skill Skill

  @core
  Scenario: Pending Build draft remains protected after leaving Configure
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    And an Agent v2 Build draft uses the updated E2E prompt
    When I open the Agent v2 configure page
    Then I should see the Agent v2 Build draft pending changes
    And I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should still use the normal E2E prompt
    When I switch to the Agent v2 Access Point section
    And I switch to the Agent v2 Configure section
    Then I should see the Agent v2 Build draft pending changes
    And I should see the updated E2E prompt in the Agent v2 prompt editor
    And the normal Agent v2 draft should still use the normal E2E prompt

  @build-tool-writeback @feature-gated
  Scenario: Applying a Build draft can add Dify Tools to the Agent configuration
    Given I am signed in as the default E2E admin
    And Agent v2 Build chat Dify Tool writeback is available
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 Build chat Dify Tool writeback should be available

  @build-unavailable-resources @feature-gated
  Scenario: Build chat reports unavailable Skill or Tool requests clearly
    Given I am signed in as the default E2E admin
    And Agent v2 Build chat unavailable Skill and Tool recovery is available
    And the Agent Builder stable chat model is available
    And a runnable Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    Then Agent v2 Build chat unavailable Skill and Tool recovery should be available
