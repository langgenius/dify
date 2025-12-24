import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { BinaryStream, DifyStream, Headers, StreamEvent } from "../types/common";

const readLines = async function* (stream: Readable): AsyncIterable<string> {
  const decoder = new StringDecoder("utf8");
  let buffered = "";
  for await (const chunk of stream) {
    buffered += decoder.write(chunk as Buffer);
    let index = buffered.indexOf("\n");
    while (index >= 0) {
      let line = buffered.slice(0, index);
      buffered = buffered.slice(index + 1);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      yield line;
      index = buffered.indexOf("\n");
    }
  }
  buffered += decoder.end();
  if (buffered) {
    yield buffered;
  }
};

const parseMaybeJson = (value: string): unknown => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const parseSseStream = async function* <T>(
  stream: Readable
): AsyncIterable<StreamEvent<T>> {
  let eventName: string | undefined;
  const dataLines: string[] = [];

  const emitEvent = function* (): Iterable<StreamEvent<T>> {
    if (!eventName && dataLines.length === 0) {
      return;
    }
    const raw = dataLines.join("\n");
    const parsed = parseMaybeJson(raw) as T | string | null;
    yield {
      event: eventName,
      data: parsed,
      raw,
    };
    eventName = undefined;
    dataLines.length = 0;
  };

  for await (const line of readLines(stream)) {
    if (!line) {
      yield* emitEvent();
      continue;
    }
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
      continue;
    }
  }

  yield* emitEvent();
};

const extractTextFromEvent = (data: unknown): string => {
  if (typeof data === "string") {
    return data;
  }
  if (!data || typeof data !== "object") {
    return "";
  }
  const record = data as Record<string, unknown>;
  if (typeof record.answer === "string") {
    return record.answer;
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.delta === "string") {
    return record.delta;
  }
  return "";
};

export const createSseStream = <T>(
  stream: Readable,
  meta: { status: number; headers: Headers; requestId?: string }
): DifyStream<T> => {
  const iterator = parseSseStream<T>(stream)[Symbol.asyncIterator]();
  const iterable = {
    [Symbol.asyncIterator]: () => iterator,
    data: stream,
    status: meta.status,
    headers: meta.headers,
    requestId: meta.requestId,
    toReadable: () => stream,
    toText: async () => {
      let text = "";
      for await (const event of iterable) {
        text += extractTextFromEvent(event.data);
      }
      return text;
    },
  } satisfies DifyStream<T>;

  return iterable;
};

export const createBinaryStream = (
  stream: Readable,
  meta: { status: number; headers: Headers; requestId?: string }
): BinaryStream => ({
  data: stream,
  status: meta.status,
  headers: meta.headers,
  requestId: meta.requestId,
  toReadable: () => stream,
});
