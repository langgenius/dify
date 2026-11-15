@apps @chatflow @web-app-runtime @core @unauthenticated
Feature: Published Chatflow conversation history
  Scenario: An anonymous visitor resumes a conversation after reloading
    Given a model-free echo Chatflow has been published via API
    When I open the shared app URL
    And I send "first-history-marker" to the published Chatflow
    Then the published Chatflow should answer "Echo: first-history-marker"
    When I refresh the current page
    Then the published Chatflow should answer "Echo: first-history-marker"
    When I send "second-history-marker" to the published Chatflow
    Then the published Chatflow should answer "Echo: second-history-marker"
    When I refresh the current page
    Then the published Chatflow should answer "Echo: first-history-marker"
    And the published Chatflow should answer "Echo: second-history-marker"
