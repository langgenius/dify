@agent-v2 @authenticated @core @output-routes
Feature: Agent v2 output routes across workflow surfaces
  @output-route-sort
  Scenario: Dragging output routes preserves their saved order
    Given I am signed in as the default E2E admin
    And a workflow with two Agent v2 output routes and a failure branch has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    And I drag the Rejected Agent output route above Accepted
    Then the Agent output route order should be saved as Rejected then Accepted
    When I refresh the current page
    And I open the Agent v2 workflow node panel
    Then the Agent output route editor should show Rejected before Accepted

  @output-route-snippet
  Scenario: Inserting a routed Agent snippet leaves its route destinations for the user to choose
    Given I am signed in as the default E2E admin
    And a published snippet ending in an Agent v2 with output routes has been created via API
    And a "workflow" app has been created via API
    And a minimal runnable workflow draft has been synced
    When I open the app from the app list
    And I insert the routed Agent snippet between Start and End
    Then the inserted Agent should receive the Start connection and leave its output routes unconnected

  @output-route-undo
  Scenario: One undo restores output routes and their connections after disabling them
    Given I am signed in as the default E2E admin
    And a workflow with two Agent v2 output routes and a failure branch has been created via API
    When I open the app from the app list
    And I open the Agent v2 workflow node panel
    And I disable the Agent output routes and undo the saved change once
    And I open the Agent v2 workflow node panel
    Then the Agent output routes and both successful connections should be restored
