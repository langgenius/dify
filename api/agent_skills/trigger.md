## Overview

Trigger is a collection of nodes that we called `Start` nodes, also, the concept of `Start` is the same as `RootNode` in the workflow engine `core/workflow/graph_engine`, On the other hand, `Start` node is the entry point of workflows, every workflow run always starts from a `Start` node.

## Trigger nodes

- `UserInput`
- `Trigger Webhook`
- `Trigger Schedule`
- `Trigger Plugin`

### UserInput

Before `Trigger` concept is introduced, it's what we called `Start` node, but now, to avoid confusion, it was renamed to `UserInput` node, has a strong relation with `ServiceAPI` in `controllers/service_api/app`

1. `UserInput` node introduces a list of arguments that need to be provided by the user, finally it will be converted into variables in the workflow variable pool.
1. `ServiceAPI` accept those arguments, and pass through them into `UserInput` node.
1. For its detailed implementation, please refer to `core/workflow/nodes/start`

### Trigger Webhook

Inside Webhook Node, Dify provided a UI panel that allows user define a HTTP manifest `core/workflow/nodes/trigger_webhook/entities.py`.`WebhookData`, also, Dify generates a random webhook id for each `Trigger Webhook` node, the implementation was implemented in `core/trigger/utils/endpoint.py`, as you can see, `webhook-debug` is a debug mode for webhook, you may find it in `controllers/trigger/webhook.py`.

Finally, requests to `webhook` endpoint will be converted into variables in workflow variable pool during workflow execution.

### Trigger Schedule

`Trigger Schedule` node is a node that allows user define a schedule to trigger the workflow, detailed manifest is here `core/workflow/nodes/trigger_schedule/entities.py`, we have a poller and executor to handle millions of schedules, see `docker/entrypoint.sh` / `schedule/workflow_schedule_task.py` for help.

To Achieve this, a `WorkflowSchedulePlan` model was introduced in `models/trigger.py`, and a `events/event_handlers/sync_workflow_schedule_when_app_published.py` was used to sync workflow schedule plans when app is published.

### Trigger Plugin

`Trigger Plugin` node allows user define there own distributed trigger plugin, whenever a request was received, Dify forwards it to the plugin and wait for parsed variables from it.

1. Requests were saved in storage by `services/trigger/trigger_request_service.py`, referenced by `services/trigger/trigger_service.py`.`TriggerService`.`process_endpoint`
1. Plugins accept those requests and parse variables from it, see `core/plugin/impl/trigger.py` for details.

A `subscription` concept was out here by Dify, it means an endpoint address from Dify was bound to thirdparty webhook service like `Github` `Slack` `Linear` `GoogleDrive` `Gmail` etc. Once a subscription was created, Dify continually receives requests from the platforms and handle them one by one.

## Worker Pool / Async Task

All the events that triggered a new workflow run is always in async mode, a unified entrypoint can be found here `services/async_workflow_service.py`.`AsyncWorkflowService`.`trigger_workflow_async`.

The infrastructure we used is `celery`, we've already configured it in `docker/entrypoint.sh`, and the consumers are in `tasks/async_workflow_tasks.py`, 3 queues were used to handle different tiers of users, `PROFESSIONAL_QUEUE` `TEAM_QUEUE` `SANDBOX_QUEUE`.

## Debug Strategy

Dify divided users into 2 groups: builders / end users.

Builders are the users who create workflows, in this stage, debugging a workflow becomes a critical part of the workflow development process, as the start node in workflows, trigger nodes can `listen` to the events from `WebhookDebug` `Schedule` `Plugin`, debugging process was created in `controllers/console/app/workflow.py`.`DraftWorkflowTriggerNodeApi`.

A polling process can be considered as combine of few single `poll` operations, each `poll` operation fetches events cached in `Redis`, returns `None` if no event was found, more detailed implemented: `core/trigger/debug/event_bus.py` was used to handle the polling process, and `core/trigger/debug/event_selectors.py` was used to select the event poller based on the trigger type.
