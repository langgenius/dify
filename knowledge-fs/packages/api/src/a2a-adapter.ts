import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { z } from "zod";

export type A2ATaskState = "canceled" | "completed" | "failed" | "submitted" | "working";

export interface A2AAgentSkill {
  readonly description: string;
  readonly id: string;
  readonly name: string;
  readonly tags?: readonly string[] | undefined;
}

export interface A2AAgentCard {
  readonly capabilities: {
    readonly pushNotifications: boolean;
    readonly streaming: boolean;
  };
  readonly defaultInputModes: readonly string[];
  readonly defaultOutputModes: readonly string[];
  readonly description: string;
  readonly name: string;
  readonly preferredTransport: "JSONRPC";
  readonly protocolVersion: string;
  readonly skills: readonly A2AAgentSkill[];
  readonly url: string;
  readonly version: string;
}

export interface A2ATextPart {
  readonly kind: "text";
  readonly text: string;
}

export interface A2AMessage {
  readonly parts: readonly A2ATextPart[];
  readonly role: "agent" | "user";
}

export interface A2AArtifact {
  readonly metadata?: Record<string, unknown> | undefined;
  readonly parts: readonly A2ATextPart[];
}

export interface A2ATaskStatus {
  readonly state: A2ATaskState;
  readonly timestamp: string;
}

export interface A2ATask {
  readonly artifacts: readonly A2AArtifact[];
  readonly id: string;
  readonly metadata: Record<string, unknown>;
  readonly status: A2ATaskStatus;
}

export interface A2ATaskSubmission {
  readonly id: string;
  readonly message: A2AMessage;
  readonly metadata: Record<string, unknown>;
}

export interface A2AAdapterOptions {
  readonly agentUrl: string;
  readonly description?: string | undefined;
  readonly generateTaskId?: () => string;
  readonly maxMessageTextBytes?: number | undefined;
  readonly name?: string | undefined;
  readonly now?: () => string;
  readonly protocolVersion?: string | undefined;
  readonly skills?: readonly A2AAgentSkill[] | undefined;
  readonly taskHandler?: ((input: A2ATaskSubmission) => Promise<A2ATask> | A2ATask) | undefined;
  readonly version?: string | undefined;
}

const A2ATextPartSchema = z
  .object({
    kind: z.literal("text"),
    text: z.string().min(1),
  })
  .strict();
const A2AMessageSchema = z
  .object({
    parts: z.array(A2ATextPartSchema).min(1),
    role: z.enum(["agent", "user"]),
  })
  .strict();
const A2ATaskRequestSchema = z
  .object({
    message: A2AMessageSchema,
    metadata: z.record(z.unknown()).default({}),
  })
  .strict();
const A2ATaskResponseSchema = z
  .object({
    artifacts: z.array(
      z
        .object({
          metadata: z.record(z.unknown()).optional(),
          parts: z.array(A2ATextPartSchema),
        })
        .strict(),
    ),
    id: z.string().min(1),
    metadata: z.record(z.unknown()),
    status: z
      .object({
        state: z.enum(["canceled", "completed", "failed", "submitted", "working"]),
        timestamp: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

export function createA2AAdapter({
  agentUrl,
  description = "KnowledgeFS experimental A2A adapter",
  generateTaskId = randomUUID,
  maxMessageTextBytes = 16 * 1024,
  name = "KnowledgeFS",
  now = () => new Date().toISOString(),
  protocolVersion = "0.3.0",
  skills = [],
  taskHandler,
  version = "0.1.0",
}: A2AAdapterOptions) {
  validateA2ABound(maxMessageTextBytes, "maxMessageTextBytes");
  const app = new Hono();
  const card = createAgentCard({
    agentUrl,
    description,
    name,
    protocolVersion,
    skills,
    version,
  });
  const handler =
    taskHandler ??
    ((input: A2ATaskSubmission): A2ATask => ({
      artifacts: [],
      id: input.id,
      metadata: {},
      status: {
        state: "submitted",
        timestamp: now(),
      },
    }));

  app.get("/.well-known/agent-card.json", (context) => context.json(cloneJson(card)));

  app.post("/a2a/tasks", async (context) => {
    const parsed = await parseJsonBody(context.req.json.bind(context.req));

    if (!parsed.ok) {
      return context.json({ error: "Invalid A2A task request" }, 400);
    }

    const input = A2ATaskRequestSchema.safeParse(parsed.value);

    if (!input.success) {
      return context.json({ error: "Invalid A2A task request" }, 400);
    }

    if (messageTextBytes(input.data.message) > maxMessageTextBytes) {
      return context.json(
        {
          error: `A2A task message exceeds maxMessageTextBytes=${maxMessageTextBytes}`,
        },
        413,
      );
    }

    const task = await handler(
      cloneJson({
        id: generateTaskId(),
        message: input.data.message,
        metadata: input.data.metadata,
      }),
    );
    const response = A2ATaskResponseSchema.parse(cloneJson(task));

    return context.json(response, 202);
  });

  return app;
}

function createAgentCard({
  agentUrl,
  description,
  name,
  protocolVersion,
  skills,
  version,
}: {
  readonly agentUrl: string;
  readonly description: string;
  readonly name: string;
  readonly protocolVersion: string;
  readonly skills: readonly A2AAgentSkill[];
  readonly version: string;
}): A2AAgentCard {
  return {
    capabilities: {
      pushNotifications: false,
      streaming: false,
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json"],
    description: requiredA2AString(description, "description"),
    name: requiredA2AString(name, "name"),
    preferredTransport: "JSONRPC",
    protocolVersion: requiredA2AString(protocolVersion, "protocolVersion"),
    skills: cloneJson(skills),
    url: requiredA2AString(agentUrl, "agentUrl"),
    version: requiredA2AString(version, "version"),
  };
}

async function parseJsonBody(
  readJson: () => Promise<unknown>,
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  try {
    return { ok: true, value: await readJson() };
  } catch {
    return { ok: false };
  }
}

function messageTextBytes(message: A2AMessage): number {
  let total = 0;

  for (const part of message.parts) {
    total += new TextEncoder().encode(part.text).byteLength;
  }

  return total;
}

function validateA2ABound(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`A2A adapter ${label} must be at least 1`);
  }
}

function requiredA2AString(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`A2A adapter ${label} is required`);
  }

  return normalized;
}

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
