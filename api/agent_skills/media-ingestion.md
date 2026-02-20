# Media Ingestion Skill for Agents (v1)

## Motivation

Dify workflows support file and media uploads, but agents cannot directly
handle media inputs. This creates friction when building agent-centric
pipelines where the agent should orchestrate tasks end-to-end.

This document proposes a minimal **Media Ingestion Skill** that allows agents
to receive, inspect, and pass media references without introducing new
storage or preprocessing logic.

## Goals

- Enable agents to accept file/media references
- Expose basic metadata to the agent
- Allow safe handoff to workflows and tools
- Reuse existing Dify file infrastructure

## Non-Goals (v1)

- Uploading files directly from agents
- Transcription, vision, or audio processing
- UI changes
- New storage systems

## Skill Interface

### Input

````json
{
  "file_id": "string"
}

### Output

```json
{
  "file_id": "string",
  "mime_type": "string",
  "size": "number",
  "duration": "number | null",
  "source": "upload | workflow | api"
}


User: Here is a video of a meeting.
Agent:
1. Receives file_id
2. Inspects metadata
3. Triggers transcription workflow
````
