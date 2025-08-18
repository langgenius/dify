# Response Coordinator

Manages ordered streaming of response nodes.

## Features

### Session Management

- One active session at a time
- Queue waiting sessions
- Prevent output interleaving

### Path Analysis

- Track execution paths to response nodes
- Monitor branch edge selections
- Activate when path is deterministic

### Template Streaming

- Process static text and variables
- Pull values from OutputRegistry
- Progressive output

## Workflow

1. **Registration** - Response nodes register
2. **Monitoring** - Track edge selections
3. **Activation** - Start when path determined
4. **Streaming** - Output template content
5. **Transition** - Queue next session

## Benefits

- **Decoupled** - Nodes focus on templates
- **Scalable** - Handles complex branching
- **Consistent** - No interleaved output
- **Efficient** - Queue-based management
