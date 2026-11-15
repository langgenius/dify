@agent-v2 @authenticated
Feature: Agent v2 speech-to-text
  @build @speech-to-text @microphone @external-model @speech-to-text-model
  Scenario: Recorded speech is transcribed into the current Agent input
    Given I am signed in as the default E2E admin
    And the workspace default speech-to-text model is active
    And an Agent v2 test agent with speech-to-text enabled has been created via API
    When I open the Agent v2 configure page
    And I start Agent v2 voice input
    And I stop Agent v2 voice input after the fixture speech has played
    Then the Agent v2 speech-to-text request should succeed
    And the transcribed fixture phrase "Purple elephant seven" should appear in the Agent v2 input
    And the Agent v2 input should regain focus after transcription
