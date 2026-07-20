import { isDeepStrictEqual } from "node:util";

import type { ResearchTaskJob, ResearchTaskJobStage } from "./research-task-job";

export type ResearchTaskProgressEventType =
  | "research_task.canceled"
  | "research_task.failed"
  | "research_task.paused"
  | "research_task.resumed"
  | "research_task.stage_changed"
  | "research_task.started";

export interface ResearchTaskProgressEvent {
  readonly createdAt: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly payload: Record<string, unknown>;
  readonly researchTaskJobId: string;
  readonly sequence: number;
  readonly stage: ResearchTaskJobStage;
  readonly tenantId: string;
  readonly type: ResearchTaskProgressEventType;
}

export interface AppendResearchTaskProgressEventInput {
  readonly idempotencyKey?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly payload?: Record<string, unknown> | undefined;
  readonly researchTaskJobId: string;
  readonly stage: ResearchTaskJobStage;
  readonly tenantId: string;
  readonly type: ResearchTaskProgressEventType;
}

export interface ListResearchTaskProgressEventsInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly researchTaskJobId: string;
  readonly tenantId: string;
}

export interface ListResearchTaskProgressEventsResult {
  readonly items: readonly ResearchTaskProgressEvent[];
  readonly nextCursor?: string | undefined;
}

export interface SubscribeResearchTaskProgressInput {
  readonly cursor?: string | undefined;
  readonly researchTaskJobId: string;
  readonly tenantId: string;
}

export interface ResearchTaskProgressRepository {
  append(input: AppendResearchTaskProgressEventInput): Promise<ResearchTaskProgressEvent>;
  list(input: ListResearchTaskProgressEventsInput): Promise<ListResearchTaskProgressEventsResult>;
  subscribe(input: SubscribeResearchTaskProgressInput): AsyncIterable<ResearchTaskProgressEvent>;
}

export interface InMemoryResearchTaskProgressRepositoryOptions {
  readonly maxEvents: number;
  readonly maxListLimit: number;
  readonly maxSubscribers: number;
  readonly now?: () => string;
}

export interface ResearchTaskProgressWebhookDispatcher {
  dispatch(event: ResearchTaskProgressEvent): Promise<void> | void;
}

export interface ResearchTaskProgressPublisher {
  publish(
    job: ResearchTaskJob,
    type: ResearchTaskProgressEventType,
    payload?: Record<string, unknown>,
  ): Promise<ResearchTaskProgressEvent>;
}

export interface ResearchTaskProgressPublisherOptions {
  readonly repository: ResearchTaskProgressRepository;
  readonly webhook?: ResearchTaskProgressWebhookDispatcher | undefined;
}

interface Subscriber {
  closed: boolean;
  readonly key: string;
  readonly queue: ResearchTaskProgressEvent[];
  readonly waiters: Array<(event: ResearchTaskProgressEvent | null) => void>;
  notify(event: ResearchTaskProgressEvent): void;
}

export function createInMemoryResearchTaskProgressRepository({
  maxEvents,
  maxListLimit,
  maxSubscribers,
  now = () => new Date().toISOString(),
}: InMemoryResearchTaskProgressRepositoryOptions): ResearchTaskProgressRepository {
  validatePositive(maxEvents, "maxEvents");
  validatePositive(maxListLimit, "maxListLimit");
  validatePositive(maxSubscribers, "maxSubscribers");

  const events: ResearchTaskProgressEvent[] = [];
  const idempotentEvents = new Map<string, ResearchTaskProgressEvent>();
  const nextSequences = new Map<string, number>();
  const subscribers = new Set<Subscriber>();

  return {
    append: async (input) => {
      const scopeKey = progressKey(
        requiredString(input.tenantId, "tenantId"),
        requiredString(input.researchTaskJobId, "researchTaskJobId"),
      );
      const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
      const idempotentKey = idempotencyKey ? `${scopeKey}\u0000${idempotencyKey}` : undefined;
      const existing = idempotentKey ? idempotentEvents.get(idempotentKey) : undefined;
      if (existing) {
        assertIdempotentReplay(existing, input);
        return cloneJson(existing);
      }
      if (events.length >= maxEvents) {
        throw new Error(`Research task progress repository maxEvents=${maxEvents} exceeded`);
      }

      const event: ResearchTaskProgressEvent = {
        createdAt: now(),
        id: `research-task-progress-${events.length + 1}`,
        knowledgeSpaceId: requiredString(input.knowledgeSpaceId, "knowledgeSpaceId"),
        payload: cloneJson(input.payload ?? {}),
        researchTaskJobId: input.researchTaskJobId.trim(),
        sequence: (nextSequences.get(scopeKey) ?? 0) + 1,
        stage: input.stage,
        tenantId: input.tenantId.trim(),
        type: input.type,
      };
      events.push(event);
      nextSequences.set(scopeKey, event.sequence);
      if (idempotentKey) {
        idempotentEvents.set(idempotentKey, event);
      }

      for (const subscriber of subscribers) {
        if (subscriber.key === progressKey(event.tenantId, event.researchTaskJobId)) {
          subscriber.notify(cloneJson(event));
        }
      }

      return cloneJson(event);
    },
    list: async ({ cursor, limit, researchTaskJobId, tenantId }) => {
      assertListLimit(limit, maxListLimit);
      const afterSequence = cursor === undefined ? 0 : parseCursor(cursor);
      const normalizedJobId = requiredString(researchTaskJobId, "researchTaskJobId");
      const normalizedTenantId = requiredString(tenantId, "tenantId");
      const matching = events
        .filter(
          (event) =>
            event.tenantId === normalizedTenantId &&
            event.researchTaskJobId === normalizedJobId &&
            event.sequence > afterSequence,
        )
        .slice(0, limit + 1);
      const items = matching.slice(0, limit);
      const extra = matching[limit];

      return {
        items: cloneJson(items),
        ...(extra
          ? { nextCursor: String(items[items.length - 1]?.sequence ?? afterSequence) }
          : {}),
      };
    },
    subscribe: ({ cursor, researchTaskJobId, tenantId }) => {
      if (subscribers.size >= maxSubscribers) {
        throw new Error(
          `Research task progress subscribers exceed maxSubscribers=${maxSubscribers}`,
        );
      }

      const normalizedTenantId = requiredString(tenantId, "tenantId");
      const normalizedJobId = requiredString(researchTaskJobId, "researchTaskJobId");
      const afterSequence = cursor === undefined ? 0 : parseCursor(cursor);
      const key = progressKey(normalizedTenantId, normalizedJobId);
      const subscriber = createSubscriber(
        key,
        events.filter(
          (event) =>
            progressKey(event.tenantId, event.researchTaskJobId) === key &&
            event.sequence > afterSequence,
        ),
      );
      subscribers.add(subscriber);

      return {
        [Symbol.asyncIterator](): AsyncIterator<ResearchTaskProgressEvent> {
          return {
            next: async () => {
              const event = await nextSubscriberEvent(subscriber);

              if (!event) {
                return { done: true, value: undefined as never };
              }

              return { done: false, value: cloneJson(event) };
            },
            return: async () => {
              subscriber.closed = true;
              subscribers.delete(subscriber);
              while (subscriber.waiters.length > 0) {
                subscriber.waiters.shift()?.(null);
              }
              return { done: true, value: undefined as never };
            },
          };
        },
      };
    },
  };
}

export function createResearchTaskProgressPublisher({
  repository,
  webhook,
}: ResearchTaskProgressPublisherOptions): ResearchTaskProgressPublisher {
  return {
    publish: async (job, type, payload = {}) => {
      const event = await repository.append({
        idempotencyKey: `research-task-progress:${job.id}:${job.rowVersion}:${type}`,
        knowledgeSpaceId: job.knowledgeSpaceId,
        payload,
        researchTaskJobId: job.id,
        stage: job.stage,
        tenantId: job.tenantId,
        type,
      });
      dispatchWebhookBestEffort(webhook, event);
      return event;
    },
  };
}

function dispatchWebhookBestEffort(
  webhook: ResearchTaskProgressWebhookDispatcher | undefined,
  event: ResearchTaskProgressEvent,
): void {
  if (!webhook) return;
  try {
    void Promise.resolve(webhook.dispatch(event)).catch(() => {
      // The durable ledger is the source of truth. Webhook delivery must not turn an already
      // committed Research transition into an HTTP/worker failure or delay lease heartbeats.
    });
  } catch {
    // Synchronous dispatcher failures are best-effort for the same reason.
  }
}

function createSubscriber(
  key: string,
  queuedEvents: readonly ResearchTaskProgressEvent[] = [],
): Subscriber {
  return {
    closed: false,
    key,
    queue: queuedEvents.map(cloneJson),
    waiters: [],
    notify(event) {
      if (this.closed) {
        return;
      }

      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(event);
        return;
      }

      this.queue.push(event);
    },
  };
}

async function nextSubscriberEvent(
  subscriber: Subscriber,
): Promise<ResearchTaskProgressEvent | null> {
  if (subscriber.closed) {
    return null;
  }

  const queued = subscriber.queue.shift();
  if (queued) {
    return queued;
  }

  return new Promise((resolve) => {
    subscriber.waiters.push(resolve);
  });
}

function progressKey(tenantId: string, researchTaskJobId: string): string {
  return `${tenantId}\u0000${researchTaskJobId}`;
}

function validatePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Research task progress repository ${label} must be at least 1`);
  }
}

function assertListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Research task progress list limit must be at least 1");
  }
  if (limit > maxListLimit) {
    throw new Error(`Research task progress list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

function parseCursor(cursor: string): number {
  const parsed = Number(cursor);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Research task progress cursor is invalid");
  }

  return parsed;
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`Research task progress ${label} is required`);
  }

  return normalized;
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 512) {
    throw new Error("Research task progress idempotencyKey must contain 1-512 characters");
  }
  return normalized;
}

function assertIdempotentReplay(
  existing: ResearchTaskProgressEvent,
  input: AppendResearchTaskProgressEventInput,
): void {
  if (
    existing.tenantId !== input.tenantId.trim() ||
    existing.knowledgeSpaceId !== input.knowledgeSpaceId.trim() ||
    existing.researchTaskJobId !== input.researchTaskJobId.trim() ||
    existing.stage !== input.stage ||
    existing.type !== input.type ||
    !isDeepStrictEqual(existing.payload, cloneJson(input.payload ?? {}))
  ) {
    throw new Error("Research task progress idempotencyKey was reused with different event data");
  }
}

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
