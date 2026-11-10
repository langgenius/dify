@auth @core @unauthenticated
Feature: Return to a protected app after signing in
  Scenario: Signing in preserves the requested workflow editor
    Given a "workflow" app has been created via API
    And a minimal runnable workflow draft has been synced
    When I follow the workflow editor link without signing in
    Then I should be redirected to the signin page
    When I sign in as the default E2E admin
    Then I should return to the requested workflow editor
