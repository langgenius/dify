@workflows @authenticated @workflow-collaboration
Feature: Undo and redo my own changes to a shared workflow
  Background:
    Given two workspace editors open a Chatflow with system and user prompts

  Scenario: Undo edits to different messages in the same LLM node
    When I change the prompt "Initial system" to "My system"
    And the other editor changes the prompt "Initial user" to "Their user"
    And I undo my last canvas change
    Then both editors and the saved draft show the prompts "Initial system" and "Their user"
    When I redo my last canvas change
    Then both editors and the saved draft show the prompts "My system" and "Their user"
    When the other editor undoes their last canvas change
    Then both editors and the saved draft show the prompts "My system" and "Initial user"
    When the other editor redoes their last canvas change
    Then both editors and the saved draft show the prompts "My system" and "Their user"

  Scenario: Restore a deleted node and its connection together while keeping a collaborator's edit
    When I delete the answer node from the canvas
    And the other editor changes the prompt "Initial system" to "Keep this instruction"
    And I undo my last canvas change
    Then both editors and the saved draft include the answer node and its connection
    And both editors and the saved draft show the prompts "Keep this instruction" and "Initial user"
    When I redo my last canvas change
    Then both editors and the saved draft omit the answer node and its connection
    And both editors and the saved draft show the prompts "Keep this instruction" and "Initial user"
