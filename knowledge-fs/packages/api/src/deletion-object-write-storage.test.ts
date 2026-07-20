import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import type { DeletionObjectWriteAdmission } from "./deletion-object-write-admission";
import { createDeletionAdmittedObjectStorage } from "./deletion-object-write-storage";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("deletion-admitted object storage", () => {
  it("keeps deletion ordered behind the complete external put", async () => {
    const events: string[] = [];
    const putStarted = deferred();
    const releasePut = deferred();
    const admissionReleased = deferred();
    let activeWrites = 0;
    const admission: DeletionObjectWriteAdmission = {
      withSpaceWriteAdmission: async (scope, write) => {
        expect(scope).toEqual({ knowledgeSpaceId: "space-1", tenantId: "tenant-1" });
        activeWrites += 1;
        events.push("admission-acquired");
        try {
          return await write();
        } finally {
          activeWrites -= 1;
          events.push("admission-released");
          admissionReleased.resolve();
        }
      },
    };
    const base = createNodePlatformAdapter({ env: {} }).objectStorage;
    const objectStorage = createDeletionAdmittedObjectStorage({
      admission,
      objectStorage: {
        ...base,
        putObject: async (input) => {
          expect(activeWrites).toBe(1);
          events.push("put-started");
          putStarted.resolve();
          await releasePut.promise;
          const stored = await base.putObject(input);
          events.push("put-committed");
          return stored;
        },
      },
      scope: { knowledgeSpaceId: "space-1", tenantId: "tenant-1" },
    });

    const write = objectStorage.putObject({ body: new Uint8Array([1]), key: "tenant-1/a.bin" });
    await putStarted.promise;
    let deletionStarted = false;
    const deletion = (async () => {
      if (activeWrites > 0) await admissionReleased.promise;
      deletionStarted = true;
      events.push("deletion-started");
    })();
    await Promise.resolve();
    expect(deletionStarted).toBe(false);

    releasePut.resolve();
    await write;
    await deletion;

    expect(events).toEqual([
      "admission-acquired",
      "put-started",
      "put-committed",
      "admission-released",
      "deletion-started",
    ]);
  });
});
