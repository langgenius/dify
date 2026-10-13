@api-errors @core @authenticated
Feature: Recover from API failures without losing user input
  Scenario: An expired session returns to sign in when creating an app
    Given I am signed in as the default E2E admin
    And I have entered a new app name in the creation dialog
    And both console session tokens have expired
    When I submit the app creation form with the expired session
    Then I should be asked to sign in again

  Scenario: Permission denial preserves the app creation form and reports the server message once
    Given I am signed in as the default E2E admin
    And I have entered a new app name in the creation dialog
    And the next app creation request will be denied by the API
    When I submit the app creation form without permission
    Then the app creation form should retain my input and allow another attempt
    And I should see exactly one error notification saying "You no longer have permission to create apps."

  Scenario: A concurrent Skill edit requires confirmation before replacing local changes
    Given I am signed in as the default E2E admin
    And I am editing a disposable Skill draft that was changed elsewhere
    When I edit the stale Skill draft
    Then I should be asked to load the latest Skill draft without losing my local text
    When I confirm loading the latest Skill draft
    Then the Skill editor should show the other edit

  @agent-v2
  Scenario: A rejected file upload keeps the selected file available for retry
    Given I am signed in as the default E2E admin
    And a basic configured Agent v2 test agent has been created via API
    When I open the Agent v2 configure page
    And I upload an Agent file that the API rejects
    Then the Agent upload dialog should retain the selected file and allow another attempt
    And I should see exactly one error notification saying "Failed to upload file."
