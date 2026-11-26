@workflows @authenticated
Feature: Persist LLM node prompts in workflow drafts
  @workflow-collaboration
  Scenario: Save an offline prompt edit after reconnecting
    Given a Chatflow with a saved LLM prompt and collaboration enabled
    When I open the app from the app list
    And I open the LLM prompt editor
    And I lose the collaboration connection
    And I edit the LLM prompt
    Then the server should still have the original prompt
    When the collaboration connection returns
    Then the edited LLM prompt should be durably saved
    When I reload the Chatflow prompt editor
    Then the edited LLM prompt should still be visible

  @workflow-collaboration
  Scenario Outline: Keep a replaced draft when another editor reconnects
    Given a Chatflow with a published LLM prompt and a second editor
    When I open the app from the app list
    And the other editor opens the same Chatflow
    And I save a newer LLM prompt
    And the other editor queues changes while disconnected
    And I <replace the draft>
    Then the saved draft contains the replacement prompt
    When the other editor reconnects
    Then both editors see the replacement instead of the queued changes
    And the other editor can save and reload a new prompt

    Examples:
      | replace the draft                             |
      | restore the published LLM prompt              |
      | overwrite the draft with its original DSL     |

  @core @workflow-http-draft
  Scenario: Save and reload a prompt with collaboration disabled
    Given a Chatflow with a saved LLM prompt and collaboration disabled
    When I open the app from the app list
    And I open the LLM prompt editor
    And I edit the LLM prompt
    Then the edited LLM prompt should be saved through the ordinary HTTP draft request
    When I reload the Chatflow prompt editor
    Then the edited LLM prompt should still be visible
