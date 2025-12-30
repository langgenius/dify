import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createBinaryStream, createSseStream, parseSseStream } from "./sse";

describe("sse parsing", () => {
  it("parses event and data lines", async () => {
    const stream = Readable.from([
      "event: message\n",
      "data: {\"answer\":\"hi\"}\n",
      "\n",
    ]);
    const events = [];
    for await (const event of parseSseStream(stream)) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message");
    expect(events[0].data).toEqual({ answer: "hi" });
  });

  it("handles multi-line data payloads", async () => {
    const stream = Readable.from(["data: line1\n", "data: line2\n", "\n"]);
    const events = [];
    for await (const event of parseSseStream(stream)) {
      events.push(event);
    }
    expect(events[0].raw).toBe("line1\nline2");
    expect(events[0].data).toBe("line1\nline2");
  });

  it("createSseStream exposes toText", async () => {
    const stream = Readable.from([
      "data: {\"answer\":\"hello\"}\n\n",
      "data: {\"delta\":\" world\"}\n\n",
    ]);
    const sseStream = createSseStream(stream, {
      status: 200,
      headers: {},
      requestId: "req",
    });
    const text = await sseStream.toText();
    expect(text).toBe("hello world");
  });

  it("toText extracts text from string data", async () => {
    const stream = Readable.from(["data: plain text\n\n"]);
    const sseStream = createSseStream(stream, { status: 200, headers: {} });
    const text = await sseStream.toText();
    expect(text).toBe("plain text");
  });

  it("toText extracts text field from object", async () => {
    const stream = Readable.from(['data: {"text":"hello"}\n\n']);
    const sseStream = createSseStream(stream, { status: 200, headers: {} });
    const text = await sseStream.toText();
    expect(text).toBe("hello");
  });

  it("toText returns empty for invalid data", async () => {
    const stream = Readable.from(["data: null\n\n", "data: 123\n\n"]);
    const sseStream = createSseStream(stream, { status: 200, headers: {} });
    const text = await sseStream.toText();
    expect(text).toBe("");
  });

  it("createBinaryStream exposes metadata", () => {
    const stream = Readable.from(["chunk"]);
    const binary = createBinaryStream(stream, {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
      requestId: "req",
    });
    expect(binary.status).toBe(200);
    expect(binary.headers["content-type"]).toBe("audio/mpeg");
  });
});
