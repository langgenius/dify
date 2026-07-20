import { describe, expect, it } from "vitest";

import {
  SourceSyncPolicyError,
  computeNextSyncAt,
  parseSourceSyncPolicy,
  readSourceSyncPolicy,
  readSourceSyncState,
} from "./source-sync-policy";

describe("parseSourceSyncPolicy / readSourceSyncPolicy", () => {
  it("accepts interval and fixed-time policies", () => {
    expect(parseSourceSyncPolicy({ everyHours: 6 })).toEqual({ everyHours: 6 });
    expect(parseSourceSyncPolicy({ dailyAt: ["03:00", "15:30"], utcOffset: "+08:00" })).toEqual({
      dailyAt: ["03:00", "15:30"],
      utcOffset: "+08:00",
    });
  });

  it("rejects malformed policies with a typed error", () => {
    expect(() => parseSourceSyncPolicy({ everyHours: 0 })).toThrow(SourceSyncPolicyError);
    expect(() => parseSourceSyncPolicy({ dailyAt: ["25:00"] })).toThrow(/must be HH:MM/u);
    expect(() => parseSourceSyncPolicy({ dailyAt: ["03:00"], utcOffset: "+8" })).toThrow(
      /must be ±HH:MM/u,
    );
    expect(() => parseSourceSyncPolicy({ everyHours: 6, dailyAt: ["03:00"] })).toThrow(
      SourceSyncPolicyError,
    );
  });

  it("reads absent or invalid metadata policies as null", () => {
    expect(readSourceSyncPolicy({})).toBeNull();
    expect(readSourceSyncPolicy({ syncPolicy: { everyHours: "6" } })).toBeNull();
    expect(readSourceSyncPolicy({ syncPolicy: { everyHours: 6 } })).toEqual({ everyHours: 6 });
  });
});

describe("computeNextSyncAt", () => {
  it("adds the interval for everyHours policies", () => {
    expect(computeNextSyncAt({ everyHours: 6 }, "2026-07-08T01:30:00.000Z")).toBe(
      "2026-07-08T07:30:00.000Z",
    );
  });

  it("picks the earliest configured time-of-day strictly after the anchor (UTC)", () => {
    expect(computeNextSyncAt({ dailyAt: ["03:00", "23:00"] }, "2026-07-08T01:00:00.000Z")).toBe(
      "2026-07-08T03:00:00.000Z",
    );
    // Past today's slots -> tomorrow's earliest.
    expect(computeNextSyncAt({ dailyAt: ["03:00"] }, "2026-07-08T03:00:00.000Z")).toBe(
      "2026-07-09T03:00:00.000Z",
    );
  });

  it("applies the UTC offset for local times of day", () => {
    // 01:00Z is 09:00 at +08:00, so the next local 03:00 is tomorrow local = 19:00Z today.
    expect(
      computeNextSyncAt({ dailyAt: ["03:00"], utcOffset: "+08:00" }, "2026-07-08T01:00:00.000Z"),
    ).toBe("2026-07-08T19:00:00.000Z");
    // 12:00Z is 07:00 at -05:00, so the next local 08:30 is 13:30Z the same day.
    expect(
      computeNextSyncAt({ dailyAt: ["08:30"], utcOffset: "-05:00" }, "2026-07-08T12:00:00.000Z"),
    ).toBe("2026-07-08T13:30:00.000Z");
  });

  it("rejects an unparsable anchor", () => {
    expect(() => computeNextSyncAt({ everyHours: 1 }, "not-a-date")).toThrow(
      SourceSyncPolicyError,
    );
  });
});

describe("readSourceSyncState", () => {
  it("reads only well-typed fields", () => {
    expect(
      readSourceSyncState({
        syncState: {
          lastSyncAt: "2026-07-08T00:00:00.000Z",
          lastSyncStatus: "ok",
          nextSyncAt: 42,
        },
      }),
    ).toEqual({ lastSyncAt: "2026-07-08T00:00:00.000Z", lastSyncStatus: "ok" });
    expect(readSourceSyncState({})).toEqual({});
  });
});
