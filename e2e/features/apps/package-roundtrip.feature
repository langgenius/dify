@apps @authenticated @core @app-package
Feature: Restore an exported app package
  Scenario: An exported workflow can be imported as a separate runnable app
    Given a runnable workflow is available for an app package round trip
    When I export that workflow from Studio
    And I import the downloaded app package from Studio
    Then the imported app should preserve the workflow in a separate app
    When I reload the imported workflow editor
    And I run the workflow
    Then the workflow run should succeed
