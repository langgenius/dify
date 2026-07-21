@datasets @authenticated @new-rag-smoke
Feature: New RAG release smoke
  @new-rag-flag-default
  Scenario: The default feature configuration preserves the Legacy Knowledge experience
    Given I am signed in as the default E2E admin
    And I monitor New RAG network requests
    When I open the Knowledge console
    Then the New RAG feature should be disabled by "default-disabled"
    And the New Knowledge view should be unavailable
    When I try to open the New Knowledge creation route
    Then I should return to the Legacy Knowledge console
    And no KnowledgeFS request should leave the browser

  @new-rag-flag-disabled
  Scenario: Explicitly disabling the feature preserves the Legacy Knowledge experience
    Given I am signed in as the default E2E admin
    And I monitor New RAG network requests
    When I open the Knowledge console
    Then the New RAG feature should be disabled by "explicit-disabled"
    And the New Knowledge view should be unavailable
    When I try to open the New Knowledge creation route
    Then I should return to the Legacy Knowledge console
    And no KnowledgeFS request should leave the browser

  @new-rag-happy-path @external-source
  Scenario: Create a Knowledge space from a website and inspect its ready document
    Given I am signed in as the default E2E admin
    And the Firecrawl datasource plugin is installed
    And I monitor New RAG network requests
    When I open the Knowledge console
    Then the New RAG feature should be enabled
    And the Legacy Knowledge view should remain available
    When I switch to the New Knowledge view
    And I create a private E2E Knowledge space
    And I connect the configured Firecrawl provider
    And I crawl the configured website
    And I select every crawled page with a manual sync policy
    Then the website source should become active
    When I open the source Documents
    Then a crawled document should become ready
    When I open the ready document
    Then I should see its revision and chunk tree
    When I refresh the current page
    Then the same document detail should be restored
    And the KnowledgeFS tenant and read-only boundaries should hold
    And the New RAG requests should be proxied with diagnostics
