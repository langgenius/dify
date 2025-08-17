# ResponseStreamCoordinator

## Overview

The ResponseStreamCoordinator manages the streaming output from response nodes (Answer and End nodes) in the workflow graph engine. It ensures that responses are streamed in the correct order, coordinating between multiple response nodes and handling complex branching scenarios.

## Core Functions

### 1. Response Session Management

- Creates and manages streaming sessions for response nodes
- Maintains an active session and a queue of waiting sessions
- Ensures only one response streams at a time to prevent output interleaving

### 2. Path Analysis and Tracking

- Analyzes all possible execution paths from the root node to each response node
- Tracks branch edges that must be taken for a response node to become reachable
- Updates path states as edges are taken during workflow execution

### 3. Template-Based Streaming

- Processes response templates containing both static text and dynamic variable segments
- Coordinates retrieval of variable values from the OutputRegistry
- Maintains streaming position within each template for progressive output

### 4. Edge-Triggered Activation

- Monitors edge selections from branch nodes
- Activates response nodes when their paths become deterministic
- Automatically starts queued sessions when the active session completes

## Key Principles

### Deterministic Ordering

Response nodes only begin streaming when their execution path is fully determined. This prevents premature or out-of-order responses in workflows with conditional branches.

### Template Segment Processing

Templates are processed segment by segment, with the coordinator waiting for required variable values before proceeding. This enables smooth streaming even when upstream nodes are still executing.

### Session Isolation

Each response node gets exactly one session per workflow execution, preventing duplicate outputs while ensuring all reachable responses are delivered.

### Progressive Streaming

The coordinator streams available content immediately rather than waiting for complete responses, providing better user experience through reduced perceived latency.

## Workflow Integration

The ResponseStreamCoordinator operates as follows:

1. **Registration Phase**: Response nodes register with the coordinator, which analyzes their paths and creates sessions
2. **Execution Monitoring**: As the workflow executes, the coordinator tracks edge selections and node outputs
3. **Activation Logic**: When a response node's path becomes deterministic, its session activates or queues
4. **Streaming Process**: Active sessions stream their template content, pulling variable values from the OutputRegistry
5. **Session Transition**: Completed sessions trigger the next queued session automatically

## Design Benefits

### Decoupled Architecture

Response nodes don't need to manage their own streaming logic, focusing instead on template definition while the coordinator handles execution timing.

### Scalable Branching

The path-based approach scales to complex workflows with multiple branches and response nodes without requiring special handling in the nodes themselves.

### Consistent Output

By serializing response streaming, the coordinator ensures clean, non-interleaved output even in parallel execution scenarios.

### Efficient Resource Usage

The queue-based session management prevents resource waste from simultaneous streaming attempts while ensuring all responses are eventually delivered.
