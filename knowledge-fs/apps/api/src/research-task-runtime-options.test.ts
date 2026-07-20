import { createInMemoryResearchTaskProgressRepository } from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";

import {
  assertApiResearchTaskDurability,
  createApiResearchTaskRuntime,
} from "./research-task-runtime-options";

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
    const assembly = createApiResearchTaskRuntime({
      access: {} as never,
      adapter: { jobs: {} } as never,
      generator: {} as never,
      manifests: {} as never,
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
});
