import { describe, expect, it, vi } from "vitest";

import { ParserResourceLimitError } from "./parser-resource-budget";
import {
  documentJsonRootType,
  isDocumentRecord,
  parseDocumentJson,
  stringifyDocumentJson,
} from "./structured-json";

describe("lossless document JSON", () => {
  it.each([
    "9007199254740993",
    "-9007199254740993",
    "1.2300e+05",
    "-0",
    "1e10000",
    "0.00000000000000000000000000000000000000000000000000000001",
  ])("preserves numeric lexemes without conversion: %s", (text) => {
    const parsed = parseDocumentJson(text);
    expect(stringifyDocumentJson(parsed)).toBe(text);
    expect(documentJsonRootType(parsed)).toBe("number");
    expect(isDocumentRecord(parsed)).toBe(false);
  });

  it.each(["true", "false", "null", '"abc"', "[]", "{}"])(
    "preserves scalar and empty container values: %s",
    (text) => {
      expect(stringifyDocumentJson(parseDocumentJson(text))).toBe(text);
    },
  );

  it("preserves mixed arrays without turning scalar values into records", () => {
    const source = '[9007199254740993,1.2300e+05,-0,true,false,null,"abc",[],{}]';
    const parsed = parseDocumentJson(source);
    expect(stringifyDocumentJson(parsed)).toBe(source);
    expect(documentJsonRootType(parsed)).toBe("array");
    expect(isDocumentRecord(parsed)).toBe(false);
  });

  it("identifies ordinary record and scalar root types", () => {
    expect(documentJsonRootType(parseDocumentJson('{"name":"record"}'))).toBe("object");
    expect(documentJsonRootType(parseDocumentJson("true"))).toBe("boolean");
    expect(documentJsonRootType(parseDocumentJson('"text"'))).toBe("string");
  });

  it("preserves a native bigint supplied by a structured decoder", () => {
    expect(stringifyDocumentJson({ id: 9007199254740993n })).toBe('{"id":9007199254740993}');
  });

  it("treats library marker and serialization method names as ordinary fields", () => {
    const source = '{"isLosslessNumber":true,"value":"keep","toJSON":"not a method"}';
    const parsed = parseDocumentJson(source);
    expect(stringifyDocumentJson(parsed)).toBe(source);
    expect(isDocumentRecord(parsed)).toBe(true);
  });

  it("preserves __proto__ as an own data property without changing the object prototype", () => {
    const source = '{"__proto__":{"polluted":true},"constructor":"keep","prototype":"keep"}';
    const parsed = parseDocumentJson(source) as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
    expect([null, Object.prototype]).toContain(Object.getPrototypeOf(parsed));
    expect(stringifyDocumentJson(parsed)).toBe(source);
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("preserves nested and Unicode-escaped prototype field names", () => {
    const source = '[{"nested":{"__pro\\u0074o__":null}},{"__proto__":"string value"}]';
    const parsed = parseDocumentJson(source);
    expect(stringifyDocumentJson(parsed)).toBe(
      '[{"nested":{"__proto__":null}},{"__proto__":"string value"}]',
    );
  });

  it("does not invoke toJSON hooks on serializer input", () => {
    const toJSON = vi.fn(() => "unexpected hook");
    const output = stringifyDocumentJson({ toJSON, value: 42 });
    expect(toJSON).not.toHaveBeenCalled();
    expect(output).toBe('{"toJSON":null,"value":42}');
  });

  it("ignores inherited fields when serializing document objects", () => {
    const value = Object.assign(Object.create({ inherited: "not document data" }), { own: "keep" });
    expect(stringifyDocumentJson(value)).toBe('{"own":"keep"}');
  });

  it("preserves numeric text when pretty-printing nested records", () => {
    const value = parseDocumentJson('{"items":[{"id":9007199254740993}],"empty":{}}');
    expect(stringifyDocumentJson(value, true)).toBe(
      '{\n  "items": [\n    {\n      "id": 9007199254740993\n    }\n  ],\n  "empty": {}\n}',
    );
  });

  it("preserves escaped controls, astral Unicode, and lone surrogate strings", () => {
    const source = JSON.stringify({ '\u0000"\\😀': "\b\t\n\f\r\u001f中文😀\ud800\udc00\ud800" });
    expect(stringifyDocumentJson(parseDocumentJson(source))).toBe(source);
  });

  it.each(["", "[1,]", '{"a":}', "01", "NaN", "Infinity", '"unterminated'])(
    "rejects invalid document JSON instead of returning a partial value: %s",
    (text) => {
      expect(() => parseDocumentJson(text)).toThrow();
    },
  );

  it("rejects excessive input nesting before lossless parsing", () => {
    expect(() => parseDocumentJson(`${"[".repeat(129)}0${"]".repeat(129)}`)).toThrow(
      ParserResourceLimitError,
    );
  });

  it("rejects cyclic serializer input without recursive stack exhaustion", () => {
    const cycle: unknown[] = [];
    cycle.push(cycle);
    expect(() => stringifyDocumentJson(cycle)).toThrow(ParserResourceLimitError);
  });
});
