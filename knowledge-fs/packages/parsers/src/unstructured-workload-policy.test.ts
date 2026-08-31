import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  classifyKnownHeavyUnstructuredWorkload,
  classifyUnstructuredWorkload,
} from "./unstructured-workload-policy";

const standardArchiveRemoteFormats = [
  ["document.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ["workbook.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["document.odt", "application/vnd.oasis.opendocument.text"],
  ["book.epub", "application/epub+zip"],
] as const;

const opaqueRemoteFormats = [
  ["document.doc", "application/msword"],
  ["slides.ppt", "application/vnd.ms-powerpoint"],
  ["workbook.xls", "application/vnd.ms-excel"],
  ["document.rtf", "application/rtf"],
  ["message.eml", "message/rfc822"],
  ["message.msg", "application/vnd.ms-outlook"],
] as const;

describe("classifyUnstructuredWorkload", () => {
  it.each([
    ["report.pdf", "application/pdf", 1024, "pdf-format"],
    ["legacy.doc", "application/msword", 1024, "opaque-format"],
    ["large.docx", standardArchiveRemoteFormats[0][1], 8 * 1024 * 1024 + 1, "input-bytes"],
    ["renamed.pptx", "application/msword", 1024, "format-conflict"],
  ] as const)(
    "preclassifies metadata-known heavy input %s before source bytes are loaded",
    (filename, mimeType, sizeBytes, reason) => {
      expect(classifyKnownHeavyUnstructuredWorkload({ filename, mimeType, sizeBytes })).toEqual({
        kind: "heavy",
        reason,
      });
    },
  );

  it("leaves compact archive structure unknown until its bytes can be inspected", () => {
    expect(
      classifyKnownHeavyUnstructuredWorkload({
        filename: "ordinary.docx",
        mimeType: standardArchiveRemoteFormats[0][1],
        sizeBytes: 1024,
      }),
    ).toBeNull();
  });

  it("does not preclassify a native-sized Markdown document by bytes alone", () => {
    expect(
      classifyKnownHeavyUnstructuredWorkload({
        filename: "large-but-native.md",
        mimeType: "text/markdown",
        sizeBytes: 9 * 1024 * 1024,
      }),
    ).toBeNull();
  });

  it.each(standardArchiveRemoteFormats)(
    "classifies an ordinary %s request as standard",
    (filename, mimeType) => {
      expect(
        classifyUnstructuredWorkload({
          body: zipSync({ "content.xml": strToU8("<content />") }),
          filename,
          mimeType,
        }),
      ).toEqual({ kind: "standard", reason: "ordinary-document" });
    },
  );

  it.each(opaqueRemoteFormats)(
    "routes an opaque %s request through the heavy lane even when compressed bytes are small",
    (filename, mimeType) => {
      expect(
        classifyUnstructuredWorkload({
          body: new Uint8Array([1, 2, 3]),
          filename,
          mimeType,
        }),
      ).toEqual({ kind: "heavy", reason: "opaque-format" });
    },
  );

  it("keeps every PDF on the heavy policy because compressed page trees are not cheaply countable", () => {
    expect(
      classifyUnstructuredWorkload({
        body: new TextEncoder().encode("%PDF-1.7"),
        filename: "report.pdf",
        mimeType: "application/pdf",
      }),
    ).toEqual({ kind: "heavy", reason: "pdf-format" });
  });

  it("fails conservatively when a PDF filename conflicts with an Office MIME type", () => {
    expect(
      classifyUnstructuredWorkload({
        body: new TextEncoder().encode("%PDF-1.7"),
        filename: "report.pdf",
        mimeType: "application/msword",
      }),
    ).toEqual({ kind: "heavy", reason: "pdf-format" });
  });

  it("recognizes PDF magic even when both filename and MIME type are mislabeled", () => {
    expect(
      classifyUnstructuredWorkload({
        body: new TextEncoder().encode("prefix\n%PDF-1.7"),
        filename: "report.doc",
        mimeType: "application/msword",
      }),
    ).toEqual({ kind: "heavy", reason: "pdf-format" });
  });

  it("inspects a ZIP body even when its Office filename and MIME type disagree", () => {
    const body = zipWithDeclaredEntry({
      compressedBytes: 1,
      filename: "word/document.xml",
      uncompressedBytes: 600 * 1024 * 1024,
    });

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "report.doc",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toEqual({ kind: "rejected", reason: "archive-expansion-limit" });
  });

  it("routes conflicting known non-PDF format signals through the heavy lane", () => {
    expect(
      classifyUnstructuredWorkload({
        body: new Uint8Array([1, 2, 3]),
        filename: "slides.pptx",
        mimeType: "application/msword",
      }),
    ).toEqual({ kind: "heavy", reason: "format-conflict" });
  });

  it.each([...standardArchiveRemoteFormats, ...opaqueRemoteFormats])(
    "classifies a byte-heavy %s request as heavy",
    (filename, mimeType) => {
      expect(
        classifyUnstructuredWorkload({
          body: new Uint8Array(8 * 1024 * 1024 + 1),
          filename,
          mimeType,
        }),
      ).toEqual({ kind: "heavy", reason: "input-bytes" });
    },
  );

  it("classifies a long but compact PDF from bounded page markers", () => {
    const body = new TextEncoder().encode(
      `%PDF-1.7\n${Array.from({ length: 81 }, (_, index) => `${index} 0 obj <</Type /Page>>`).join("\n")}`,
    );

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "annual-report.pdf",
        mimeType: "application/octet-stream",
      }),
    ).toEqual({ kind: "heavy", reason: "pdf-format" });
  });

  it("classifies a structurally large OOXML container without inflating its entries", () => {
    const body = zipSync(
      Object.fromEntries(
        Array.from({ length: 81 }, (_, index) => [
          `ppt/slides/slide${index + 1}.xml`,
          strToU8("<p:sld />"),
        ]),
      ),
    );

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "quarterly-review.pptx",
        mimeType: "application/octet-stream",
      }),
    ).toEqual({ kind: "heavy", reason: "archive-structure" });
  });

  it("classifies a compact OOXML body with more than 64 MiB of declared markup as heavy", () => {
    const body = zipWithDeclaredEntries(
      Array.from({ length: 20 }, (_, index) => ({
        compressedBytes: 64 * 1024,
        filename: `xl/worksheets/sheet-part-${index + 1}.xml`,
        uncompressedBytes: 4 * 1024 * 1024,
      })),
    );

    expect(body.byteLength).toBeLessThan(8 * 1024 * 1024);
    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "compact-but-large.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toEqual({ kind: "heavy", reason: "archive-structure" });
  });

  it("isolates a legitimate highly-compressible worksheet without rejecting it as a ZIP bomb", () => {
    const body = zipSync({
      "xl/worksheets/sheet1.xml": strToU8("<c><v>0</v></c>".repeat(150_000)),
    });

    expect(body.byteLength).toBeLessThan(8 * 1024 * 1024);
    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "repetitive.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toEqual({ kind: "heavy", reason: "archive-structure" });
  });

  it("rejects a ZIP container whose central directory declares a decompression hazard", () => {
    const body = zipWithDeclaredEntry({
      compressedBytes: 1,
      filename: "word/document.xml",
      uncompressedBytes: 600 * 1024 * 1024,
    });

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "hazard.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toEqual({ kind: "rejected", reason: "archive-expansion-limit" });
  });

  it("rejects a ZIP directory whose entry count leaves uninspected central records", () => {
    const body = zipWithDeclaredEntries([
      { compressedBytes: 10, filename: "word/document.xml", uncompressedBytes: 100 },
      { compressedBytes: 10, filename: "word/styles.xml", uncompressedBytes: 100 },
    ]);
    const endView = new DataView(body.buffer, body.byteOffset + body.byteLength - 22, 22);
    endView.setUint16(8, 1, true);
    endView.setUint16(10, 1, true);

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "forged.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toEqual({ kind: "rejected", reason: "archive-expansion-limit" });
  });

  it("does not accept a forged EOCD record embedded in the real ZIP comment", () => {
    const hazardous = zipWithDeclaredEntry({
      compressedBytes: 1,
      filename: "word/document.xml",
      uncompressedBytes: 600 * 1024 * 1024,
    });
    const body = new Uint8Array(hazardous.byteLength + 22);
    body.set(hazardous);
    const realEnd = new DataView(body.buffer, hazardous.byteLength - 22, 22);
    realEnd.setUint16(20, 22, true);
    const forgedEnd = new DataView(body.buffer, hazardous.byteLength, 22);
    forgedEnd.setUint32(0, 0x06054b50, true);
    forgedEnd.setUint32(16, hazardous.byteLength, true);

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "forged-comment.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toEqual({ kind: "rejected", reason: "archive-expansion-limit" });
  });

  it("inspects a ZIP container with a legal prepended executable stub", () => {
    const archive = zipWithDeclaredEntry({
      compressedBytes: 1,
      filename: "xl/worksheets/sheet1.xml",
      uncompressedBytes: 70 * 1024 * 1024,
    });
    const body = new Uint8Array(128 + archive.byteLength);
    body.fill(0x41, 0, 128);
    body.set(archive, 128);

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "self-extracting.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toEqual({ kind: "rejected", reason: "archive-expansion-limit" });
  });

  it("rejects a hazardous ZIP body even when opaque legacy metadata hides the container", () => {
    const archive = zipWithDeclaredEntry({
      compressedBytes: 1,
      filename: "xl/worksheets/sheet1.xml",
      uncompressedBytes: 70 * 1024 * 1024,
    });
    const body = new Uint8Array(128 + archive.byteLength);
    body.fill(0x41, 0, 128);
    body.set(archive, 128);

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "mislabeled.doc",
        mimeType: "application/msword",
      }),
    ).toEqual({ kind: "rejected", reason: "archive-expansion-limit" });
  });

  it("does not let trailing garbage hide a hazardous but otherwise readable ZIP directory", () => {
    const archive = zipWithDeclaredEntry({
      compressedBytes: 1,
      filename: "xl/worksheets/sheet1.xml",
      uncompressedBytes: 70 * 1024 * 1024,
    });
    const body = new Uint8Array(archive.byteLength + 1);
    body.set(archive);
    body[body.byteLength - 1] = 0x41;

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "trailing-byte.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toEqual({ kind: "rejected", reason: "archive-expansion-limit" });
  });

  it("isolates an archive-backed format with a ZIP signature but no valid directory", () => {
    const body = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "truncated.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toEqual({ kind: "heavy", reason: "archive-invalid" });
  });

  it("uses the normalized MIME type before an untrusted filename extension", () => {
    const body = new TextEncoder().encode(
      `%PDF-1.7\n${Array.from({ length: 81 }, (_, index) => `${index} 0 obj <</Type /Page>>`).join("\n")}`,
    );

    expect(
      classifyUnstructuredWorkload({
        body,
        filename: "renamed.docx",
        mimeType: " APPLICATION/PDF; charset=binary ",
      }),
    ).toEqual({ kind: "heavy", reason: "pdf-format" });
  });
});

function zipWithDeclaredEntry({
  compressedBytes,
  filename,
  uncompressedBytes,
}: {
  readonly compressedBytes: number;
  readonly filename: string;
  readonly uncompressedBytes: number;
}): Uint8Array {
  return zipWithDeclaredEntries([{ compressedBytes, filename, uncompressedBytes }]);
}

function zipWithDeclaredEntries(
  entries: readonly {
    readonly compressedBytes: number;
    readonly filename: string;
    readonly uncompressedBytes: number;
  }[],
): Uint8Array {
  const encodedEntries = entries.map((entry) => ({
    ...entry,
    filenameBytes: new TextEncoder().encode(entry.filename),
  }));
  const localHeader = new Uint8Array(30);
  const centralDirectory = new Uint8Array(
    encodedEntries.reduce((total, entry) => total + 46 + entry.filenameBytes.byteLength, 0),
  );
  const endOfCentralDirectory = new Uint8Array(22);
  const localView = new DataView(localHeader.buffer);
  const endView = new DataView(endOfCentralDirectory.buffer);

  localView.setUint32(0, 0x04034b50, true);
  let centralOffset = 0;
  for (const entry of encodedEntries) {
    const centralView = new DataView(
      centralDirectory.buffer,
      centralDirectory.byteOffset + centralOffset,
      46 + entry.filenameBytes.byteLength,
    );
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint32(20, entry.compressedBytes, true);
    centralView.setUint32(24, entry.uncompressedBytes, true);
    centralView.setUint16(28, entry.filenameBytes.byteLength, true);
    centralDirectory.set(entry.filenameBytes, centralOffset + 46);
    centralOffset += 46 + entry.filenameBytes.byteLength;
  }
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, localHeader.byteLength, true);

  const body = new Uint8Array(
    localHeader.byteLength + centralDirectory.byteLength + endOfCentralDirectory.byteLength,
  );
  body.set(localHeader, 0);
  body.set(centralDirectory, localHeader.byteLength);
  body.set(endOfCentralDirectory, localHeader.byteLength + centralDirectory.byteLength);
  return body;
}
