@workflows @authenticated
Feature: Persist LLM node prompts in workflow drafts
  @workflow-collaboration
  Scenario: Recover a prompt edit made before the connection was interrupted
    Given a Chatflow with a saved LLM prompt and collaboration enabled
    When I open the app from the app list
    And I open the LLM prompt editor
    And I edit the prompt and interrupt its upload
    Then the server should still have the original prompt
    When I reopen the LLM prompt editor while the collaboration connection is unavailable
    Then the edited LLM prompt should still be visible
    When I reopen the editor after the collaboration connection returns
    Then the edited LLM prompt should be durably saved

  @workflow-collaboration
  Scenario: Reconcile a saved prompt after its confirmation is lost
    Given a Chatflow with a saved LLM prompt and collaboration enabled
    When I open the app from the app list
    And I open the LLM prompt editor
    And I edit the prompt and lose its successful save confirmation
    Then the server should already have the edited prompt
    And the edited LLM prompt should still be visible
    When the collaboration connection returns
    Then the retried prompt save should confirm the same stored revision

  @core @workflow-http-draft
  Scenario: Save and reload a prompt with collaboration disabled
    Given a Chatflow with a saved LLM prompt and collaboration disabled
    When I open the app from the app list
    And I open the LLM prompt editor
    And I edit the LLM prompt
    Then the edited LLM prompt should be saved through the ordinary HTTP draft request
    When I reload the Chatflow prompt editor
    Then the edited LLM prompt should still be visible
