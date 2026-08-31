import { describe, expect, it } from "vitest";

import {
  createUnstructuredRequestCoordinator,
  unstructuredRequestIdentityKey,
} from "./unstructured-request-coordinator";

const baseIdentity = {
  documentAssetId: "00000000-0000-4000-8000-000000000001",
  parserFingerprint: "unstructured@10:auto:table,image:en",
  version: 1,
} as const;

describe("Unstructured request coordinator", () => {
  it("coalesces concurrent requests for the same asset version and parser fingerprint", async () => {
    const coordinator = createUnstructuredRequestCoordinator();
    let calls = 0;
    let release: ((value: string) => void) | undefined;
    const request = async ({ markTransportStarted }: { markTransportStarted(): void }) => {
      markTransportStarted();
      calls += 1;
      return await new Promise<string>((resolve) => {
        release = resolve;
      });
    };

    const first = coordinator.run({ identity: baseIdentity, request });
    const second = coordinator.run({ identity: baseIdentity, request });
    await waitForCondition(() => calls === 1);
    release?.("artifact");

    await expect(Promise.all([first, second])).resolves.toEqual(["artifact", "artifact"]);
    expect(calls).toBe(1);
  });

  it("does not coalesce different versions or parser fingerprints", async () => {
    const coordinator = createUnstructuredRequestCoordinator();
    let calls = 0;
    const request = async ({ markTransportStarted }: { markTransportStarted(): void }) => {
      markTransportStarted();
      calls += 1;
      return calls;
    };

    const results = await Promise.all([
      coordinator.run({ identity: baseIdentity, request }),
      coordinator.run({ identity: { ...baseIdentity, version: 2 }, request }),
      coordinator.run({
        identity: { ...baseIdentity, parserFingerprint: "unstructured@10:hi_res:table:zh" },
        request,
      }),
    ]);

    expect(results).toEqual([1, 2, 3]);
    expect(calls).toBe(3);
  });

  it("waits for the shared transport to settle before observing caller cancellation", async () => {
    const coordinator = createUnstructuredRequestCoordinator();
    const controller = new AbortController();
    let calls = 0;
    let release: ((value: string) => void) | undefined;
    let canceledSettled = false;
    const request = async ({ markTransportStarted }: { markTransportStarted(): void }) => {
      markTransportStarted();
      calls += 1;
      return await new Promise<string>((resolve) => {
        release = resolve;
      });
    };

    const canceled = coordinator
      .run({ callerSignal: controller.signal, identity: baseIdentity, request })
      .finally(() => {
        canceledSettled = true;
      });
    await waitForCondition(() => calls === 1);
    controller.abort();
    await Promise.resolve();
    expect(canceledSettled).toBe(false);

    const replacement = coordinator.run({ identity: baseIdentity, request });
    expect(calls).toBe(1);
    release?.("artifact");

    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    await expect(replacement).resolves.toBe("artifact");
    expect(calls).toBe(1);
  });

  it("removes a settled failure so a later explicit attempt can retry", async () => {
    const coordinator = createUnstructuredRequestCoordinator();
    let calls = 0;
    const request = async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("transport failed");
      }
      return "recovered";
    };

    await expect(coordinator.run({ identity: baseIdentity, request })).rejects.toThrow(
      "transport failed",
    );
    await expect(coordinator.run({ identity: baseIdentity, request })).resolves.toBe("recovered");
    expect(calls).toBe(2);
  });

  it("preserves an undefined rejection value", async () => {
    const coordinator = createUnstructuredRequestCoordinator();

    await expect(
      coordinator.run({
        identity: baseIdentity,
        request: async () => {
          throw undefined;
        },
      }),
    ).rejects.toBeUndefined();
  });

  it("does not start a request for an already canceled caller", async () => {
    const coordinator = createUnstructuredRequestCoordinator();
    const controller = new AbortController();
    controller.abort();
    let calls = 0;

    await expect(
      coordinator.run({
        callerSignal: controller.signal,
        identity: baseIdentity,
        request: async () => {
          calls += 1;
          return "unexpected";
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });

  it("starts a fresh admission when an all-callers-canceled waiter has not settled yet", async () => {
    const coordinator = createUnstructuredRequestCoordinator();
    const controller = new AbortController();
    let calls = 0;
    let releaseCanceledAdmission: (() => void) | undefined;
    const request = async ({
      markTransportStarted,
      signal,
    }: {
      markTransportStarted(): void;
      signal: AbortSignal;
    }) => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((resolve) => {
          releaseCanceledAdmission = resolve;
        });
        signal.throwIfAborted();
        return "unexpected";
      }
      markTransportStarted();
      return "replacement";
    };

    const canceled = coordinator.run({
      callerSignal: controller.signal,
      identity: baseIdentity,
      request,
    });
    await waitForCondition(() => calls === 1);
    controller.abort();

    await expect(coordinator.run({ identity: baseIdentity, request })).resolves.toBe("replacement");
    releaseCanceledAdmission?.();
    await expect(canceled).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(2);
  });

  it("preserves an abort event without a signal reason after the transport settles", async () => {
    const coordinator = createUnstructuredRequestCoordinator();
    const controller = new AbortController();
    let release: (() => void) | undefined;
    const pending = coordinator.run({
      callerSignal: controller.signal,
      identity: baseIdentity,
      request: async ({ markTransportStarted }) => {
        markTransportStarted();
        return await new Promise<string>((resolve) => {
          release = () => resolve("artifact");
        });
      },
    });
    await waitForCondition(() => release !== undefined);
    controller.signal.dispatchEvent(new Event("abort"));
    release?.();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("uses an unambiguous identity tuple and validates its fields", () => {
    expect(
      unstructuredRequestIdentityKey({
        documentAssetId: "asset:1",
        parserFingerprint: "fingerprint",
        version: 2,
      }),
    ).toBe('["asset:1",2,"fingerprint"]');
    expect(() => unstructuredRequestIdentityKey({ ...baseIdentity, documentAssetId: " " })).toThrow(
      "documentAssetId must not be empty",
    );
    expect(() =>
      unstructuredRequestIdentityKey({ ...baseIdentity, parserFingerprint: " " }),
    ).toThrow("parserFingerprint must not be empty");
    expect(() => unstructuredRequestIdentityKey({ ...baseIdentity, version: 0 })).toThrow(
      "version must be a positive integer",
    );
  });
});

async function waitForCondition(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Condition was not met");
}
