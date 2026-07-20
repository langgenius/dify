import { describe, expect, it } from "vitest";

import { createApiTracingOptions } from "./tracing-options";

describe("createApiTracingOptions", () => {
  it("is off by default and via off/false/0", () => {
    expect(createApiTracingOptions({})).toBeUndefined();
    expect(createApiTracingOptions({ KNOWLEDGE_TRACING: "off" })).toBeUndefined();
    expect(createApiTracingOptions({ KNOWLEDGE_TRACING: "FALSE" })).toBeUndefined();
    expect(createApiTracingOptions({ KNOWLEDGE_TRACING: "0" })).toBeUndefined();
  });

  it("builds a console recorder", () => {
    const options = createApiTracingOptions({ KNOWLEDGE_TRACING: "console" });
    expect(options?.traces.startSpan).toBeTypeOf("function");
  });

  it("builds an otlp recorder and validates its configuration", () => {
    const options = createApiTracingOptions({
      KNOWLEDGE_TRACING: "otlp",
      KNOWLEDGE_TRACING_OTLP_ENDPOINT: "http://localhost:4318/v1/traces",
      KNOWLEDGE_TRACING_OTLP_HEADERS: '{"authorization":"Bearer x"}',
    });
    expect(options?.traces.startSpan).toBeTypeOf("function");

    expect(() => createApiTracingOptions({ KNOWLEDGE_TRACING: "otlp" })).toThrow(
      "requires KNOWLEDGE_TRACING_OTLP_ENDPOINT",
    );
    expect(() =>
      createApiTracingOptions({
        KNOWLEDGE_TRACING: "otlp",
        KNOWLEDGE_TRACING_OTLP_ENDPOINT: "http://localhost:4318/v1/traces",
        KNOWLEDGE_TRACING_OTLP_HEADERS: "not-json",
      }),
    ).toThrow("must be a JSON object");
    expect(() =>
      createApiTracingOptions({
        KNOWLEDGE_TRACING: "otlp",
        KNOWLEDGE_TRACING_FLUSH_MS: "10",
        KNOWLEDGE_TRACING_OTLP_ENDPOINT: "http://localhost:4318/v1/traces",
      }),
    ).toThrow("KNOWLEDGE_TRACING_FLUSH_MS must be an integer of at least 100");
    expect(() => createApiTracingOptions({ KNOWLEDGE_TRACING: "jaeger" })).toThrow(
      "must be off, console, or otlp",
    );
  });
});
