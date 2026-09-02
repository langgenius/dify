import {
  createInMemoryResearchTaskProgressRepository,
  createResearchTaskRuntime,
} from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";

import {
  assertApiResearchTaskDurability,
  createApiResearchTaskRuntime,
} from "./research-task-runtime-options";

vi.mock("@knowledge/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@knowledge/api")>();
  return {
    ...original,
    createResearchTaskRuntime: vi.fn(original.createResearchTaskRuntime),
  };
});

describe("Research task production durability", () => {
  it("fails closed when production would fall back to a process-local task runtime", () => {
    expect(() =>
      assertApiResearchTaskDurability({
        production: true,
        runtimeConfigured: false,
        usesDatabaseRepositories: true,
      }),
    ).toThrow("Production Research requires the database");
    expect(() =>
      assertApiResearchTaskDurability({
        production: true,
        runtimeConfigured: true,
        usesDatabaseRepositories: false,
      }),
    ).toThrow("Production Research requires the database");
  });

  it("accepts a complete production runtime and explicit local fallback", () => {
    expect(() =>
      assertApiResearchTaskDurability({
        production: true,
        runtimeConfigured: true,
        usesDatabaseRepositories: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertApiResearchTaskDurability({
        production: false,
        runtimeConfigured: false,
        usesDatabaseRepositories: false,
      }),
    ).not.toThrow();
  });

  it("uses the durable repository ledger without appending a duplicate from the state machine", async () => {
    const progress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 10,
      maxListLimit: 10,
      maxSubscribers: 2,
    });
    const append = vi.spyOn(progress, "append");
    const record = vi.fn();
    const assembly = createApiResearchTaskRuntime({
      access: {} as never,
      adapter: { jobs: {} } as never,
      generator: {} as never,
      manifests: {} as never,
      metrics: { record },
      partials: {} as never,
      progress,
      repository: {
        start: async (job: {
          id: string;
          knowledgeSpaceId: string;
          rowVersion: number;
          stage: "queued";
          tenantId: string;
        }) => {
          await progress.append({
            idempotencyKey: `research-task-progress:${job.id}:${job.rowVersion}:research_task.started`,
            knowledgeSpaceId: job.knowledgeSpaceId,
            researchTaskJobId: job.id,
            stage: job.stage,
            tenantId: job.tenantId,
            type: "research_task.started",
          });
          return job;
        },
      } as never,
    });

    const job = await assembly.jobs.start({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d03",
        revision: 1,
      },
      query: "Persist progress",
      subjectId: "subject-1",
      tenantId: "tenant-1",
    });

    expect(assembly.progress).toBe(progress);
    expect(record).toHaveBeenCalledWith({ lifecycle: "queued", taskKind: "research" });
    expect(append).toHaveBeenCalledTimes(1);
    await expect(
      progress.list({ limit: 10, researchTaskJobId: job.id, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({
      items: [
        {
          sequence: 1,
          type: "research_task.started",
        },
      ],
    });
  });

  it("publishes answer deltas through the production progress repository", async () => {
    const progress = createInMemoryResearchTaskProgressRepository({
      maxEvents: 10,
      maxListLimit: 10,
      maxSubscribers: 2,
    });
    const append = vi.spyOn(progress, "append");
    const createRuntime = vi.mocked(createResearchTaskRuntime);
    createRuntime.mockClear();

    createApiResearchTaskRuntime({
      access: {} as never,
      adapter: { jobs: {} } as never,
      generator: {} as never,
      manifests: {} as never,
      partials: {} as never,
      progress,
      repository: {} as never,
    });

    const runtimeOptions = createRuntime.mock.calls.at(-1)?.[0];
    await runtimeOptions?.progress?.publish(
      {
        id: "research-task-1",
        knowledgeSpaceId: "space-1",
        stage: "generating",
        tenantId: "tenant-1",
      } as never,
      "research_task.answer_delta",
      { delta: "Live answer", executionAttempt: 1, offset: 0 },
    );

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { delta: "Live answer", executionAttempt: 1, offset: 0 },
        type: "research_task.answer_delta",
      }),
    );
  });
});
