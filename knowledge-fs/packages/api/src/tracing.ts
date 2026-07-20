export type TraceAttributeValue = boolean | null | number | string;
export type TraceAttributes = Readonly<Record<string, TraceAttributeValue>>;

export interface TraceSpan {
  end(status: "error" | "ok", attributes?: TraceAttributes): void;
}

export interface TraceRecorder {
  startSpan(name: string, attributes: TraceAttributes): TraceSpan;
}

export interface RecordedTraceSpan {
  readonly attributes: TraceAttributes;
  readonly name: string;
  readonly status: "error" | "ok";
}

export interface InMemoryTraceRecorder extends TraceRecorder {
  readonly spans: RecordedTraceSpan[];
}

export function createNoopTraceRecorder(): TraceRecorder {
  return {
    startSpan: () => ({
      end: () => undefined,
    }),
  };
}

export function createInMemoryTraceRecorder(): InMemoryTraceRecorder {
  const spans: RecordedTraceSpan[] = [];

  return {
    spans,
    startSpan: (name, attributes) => {
      const span: {
        attributes: TraceAttributes;
        name: string;
        status: "error" | "ok";
      } = {
        attributes: { ...attributes },
        name,
        status: "ok",
      };
      let ended = false;
      spans.push(span);

      return {
        end: (status, endAttributes = {}) => {
          if (ended) {
            return;
          }

          ended = true;
          span.attributes = { ...span.attributes, ...endAttributes };
          span.status = status;
        },
      };
    },
  };
}
