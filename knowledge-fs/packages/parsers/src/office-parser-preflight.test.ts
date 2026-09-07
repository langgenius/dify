import { Zip, ZipDeflate, ZipPassThrough, strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { OfficeArchiveAdmissionError, assertOfficeArchiveSafe } from "./office-parser-preflight";

const spreadsheetMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function spreadsheetInput(xml: string, extraEntries: Record<string, Uint8Array> = {}) {
  return {
    body: zipSync({
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      ),
      "xl/workbook.xml": strToU8(
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Sheet1" sheetId="1"/></sheets></workbook>',
      ),
      "xl/worksheets/sheet1.xml": strToU8(xml),
      ...extraEntries,
    }),
    filename: "workbook.xlsx",
    mimeType: spreadsheetMime,
  };
}

function sheetXml(contents: string, dimension = "A1:B2"): string {
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/><sheetData>${contents}</sheetData></worksheet>`;
}

describe("assertOfficeArchiveSafe", () => {
  it("rejects a tiny sparse workbook before its rectangular cell span can be materialized", async () => {
    const input = spreadsheetInput(
      sheetXml(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>first</t></is></c></row><row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>last</t></is></c></row>',
        "A1:XFD1048576",
      ),
    );
    expect(input.body.byteLength).toBeLessThan(2000);
    await expect(assertOfficeArchiveSafe(input)).rejects.toThrow(OfficeArchiveAdmissionError);
  });

  it("preserves an ordinary spreadsheet without changing source bytes", async () => {
    const input = spreadsheetInput(
      sheetXml(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1"><v>5</v></c></row>',
      ),
    );
    const original = input.body.slice();
    await expect(assertOfficeArchiveSafe(input)).resolves.toBeUndefined();
    expect(input.body).toEqual(original);
  });

  it.each(["xl/alternate.xml", "custom/sheet-part"])(
    "detects worksheet content even if relationships select an unconventional part %s",
    async (part) => {
      const input = spreadsheetInput(sheetXml(""), {
        [part]: strToU8(
          sheetXml('<row r="90000"><c r="XFD90000"><v>1</v></c></row>', "A1:XFD90000"),
        ),
      });
      await expect(assertOfficeArchiveSafe(input)).rejects.toThrow("dense-cell budget");
    },
  );

  it("does not let leading whitespace hide a renamed XML worksheet", async () => {
    const input = spreadsheetInput(sheetXml(""), {
      "custom/sheet-part": strToU8(" ".repeat(4096) + sheetXml("", "A1:XFD1048576")),
    });
    // Store the member without compression so its prefix spans several admission chunks.
    input.body = zipSync(
      {
        "xl/workbook.xml": strToU8("<workbook/>"),
        "custom/sheet-part": strToU8(" ".repeat(4096) + sheetXml("", "A1:XFD1048576")),
      },
      { level: 0 },
    );
    await expect(assertOfficeArchiveSafe(input)).rejects.toThrow("dense-cell budget");
  });

  it("checks Office contents even when both filename and MIME type are misleading", async () => {
    const input = spreadsheetInput(sheetXml("", "A1:XFD1048576"));
    await expect(
      assertOfficeArchiveSafe({ ...input, filename: "plain.txt", mimeType: "text/plain" }),
    ).rejects.toThrow(OfficeArchiveAdmissionError);
  });

  it.each([
    [
      "document.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "word/document.xml",
      "document",
    ],
    [
      "slides.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "ppt/presentation.xml",
      "presentation",
    ],
    ["document.odt", "application/vnd.oasis.opendocument.text", "content.xml", "document-content"],
    ["book.epub", "application/epub+zip", "META-INF/container.xml", "container"],
  ])("accepts bounded ordinary %s archives", async (filename, mimeType, part, root) => {
    const body = zipSync({
      [part]: strToU8(`<${root}><text>Ordinary content &amp; text</text></${root}>`),
    });
    await expect(assertOfficeArchiveSafe({ body, filename, mimeType })).resolves.toBeUndefined();
  });

  it("preserves an EPUB's harmless HTML doctype", async () => {
    await expect(
      assertOfficeArchiveSafe({
        body: zipSync({
          "META-INF/container.xml": strToU8("<container/>"),
          "OPS/chapter.xhtml": strToU8(
            '<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Chapter</p></body></html>',
          ),
        }),
        filename: "book.epub",
        mimeType: "application/epub+zip",
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["-//W3C//DTD XHTML 1.1//EN", "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"],
    ["-//W3C//DTD XHTML 1.0 Strict//EN", "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"],
    [
      "-//W3C//DTD XHTML 1.0 Transitional//EN",
      "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd",
    ],
  ])(
    "preserves the standard EPUB XHTML PUBLIC doctype %s without resolving it",
    async (publicId, systemId) => {
      const body = zipSync({
        "META-INF/container.xml": strToU8("<container/>"),
        "OPS/chapter.xhtml": strToU8(
          `<!DOCTYPE html PUBLIC "${publicId}" "${systemId}"><html><body><p>Chapter</p></body></html>`,
        ),
      });
      await expect(
        assertOfficeArchiveSafe({ body, filename: "book.epub", mimeType: "application/epub+zip" }),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "https://example.invalid/evil.dtd">',
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd" [<!ENTITY evil "payload">]>',
    '<!DOCTYPE html SYSTEM "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">',
  ])("does not admit custom or internally extended XHTML DTDs", async (doctype) => {
    const body = zipSync({
      "META-INF/container.xml": strToU8("<container/>"),
      "OPS/chapter.xhtml": strToU8(`${doctype}<html><body/></html>`),
    });
    await expect(
      assertOfficeArchiveSafe({ body, filename: "book.epub", mimeType: "application/epub+zip" }),
    ).rejects.toThrow("external entities");
  });

  it.each([
    [
      '<sheet name="One" r:id="r1"/>',
      '<Relationship Id="r1" Target="https://example.invalid/sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
      "safe internal",
    ],
    [
      '<sheet name="One" r:id="r1"/>',
      '<Relationship Id="r1" Target="worksheets/sheet1.xml" TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
      "external",
    ],
    ['<sheet name="One" r:id="r1"/>', "", "missing"],
    ['<sheet name="One" r:id="r1" s:id="r2"/>', "", "ambiguous"],
    [
      '<sheet name="One" r:id="r1"/>',
      '<Relationship Id="r1" Target="../../outside.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>',
      "escapes",
    ],
  ])("rejects unsafe worksheet relationships", async (sheets, relations, message) => {
    const input = spreadsheetInput(sheetXml(""), {
      "xl/workbook.xml": strToU8(
        `<workbook xmlns:r="urn:rel" xmlns:s="urn:rel"><sheets>${sheets}</sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(`<Relationships>${relations}</Relationships>`),
    });
    await expect(assertOfficeArchiveSafe(input)).rejects.toThrow(message);
  });

  it("bounds logical sheet count rather than only ZIP part count", async () => {
    const input = spreadsheetInput(sheetXml(""), {
      "xl/workbook.xml": strToU8(
        '<workbook><sheets><sheet name="One"/><sheet name="Two"/></sheets></workbook>',
      ),
    });
    await expect(assertOfficeArchiveSafe(input, { maxWorksheets: 1 })).rejects.toThrow(
      "too many worksheets",
    );
  });

  it("keeps column formatting indices inside the format limit", async () => {
    await expect(
      assertOfficeArchiveSafe(
        spreadsheetInput('<worksheet><cols><col min="1" max="20000"/></cols></worksheet>'),
      ),
    ).rejects.toThrow("column formatting");
  });

  it.each(["utf16le", "utf16be"])(
    "recognizes %s encoded spreadsheet dimensions",
    async (encoding) => {
      const bytes = Buffer.from(
        `\ufeff<?xml version="1.0" encoding="UTF-16"?>${sheetXml("", "A1:XFD1048576")}`,
        "utf16le",
      );
      if (encoding === "utf16be") bytes.swap16();
      const input = spreadsheetInput(sheetXml(""), { "xl/worksheets/sheet1.xml": bytes });
      await expect(assertOfficeArchiveSafe(input)).rejects.toThrow("dense-cell budget");
    },
  );

  it("rejects a UTF-32 part instead of misreading its NUL-padded tags as unimportant XML", async () => {
    const xml = sheetXml("", "A1:XFD1048576");
    const bytes = Uint8Array.from(
      [...xml].flatMap((character) => [character.charCodeAt(0), 0, 0, 0]),
    );
    await expect(
      assertOfficeArchiveSafe(spreadsheetInput(sheetXml(""), { "custom/worksheet": bytes })),
    ).rejects.toThrow(OfficeArchiveAdmissionError);
  });

  it.each(["utf16le", "utf16be"])(
    "recognizes BOM-less %s XML with a whitespace prefix",
    async (encoding) => {
      const bytes = Buffer.from(` \n${sheetXml("", "A1:XFD1048576")}`, "utf16le");
      if (encoding === "utf16be") bytes.swap16();
      await expect(
        assertOfficeArchiveSafe(spreadsheetInput(sheetXml(""), { "custom/worksheet": bytes })),
      ).rejects.toThrow(OfficeArchiveAdmissionError);
    },
  );

  it("handles inferred coordinates and legal column format bounds", async () => {
    const xml =
      '<worksheet><cols><col min="1" max="3"/></cols><sheetData><row><c/><c/></row><row><c/></row></sheetData><mergeCells><mergeCell ref="A1:C2"/></mergeCells></worksheet>';
    await expect(assertOfficeArchiveSafe(spreadsheetInput(xml))).resolves.toBeUndefined();
  });

  it("admits a long narrow table inside the dense-cell budget", async () => {
    const input = spreadsheetInput(
      sheetXml(
        '<row r="1"><c r="A1"><v>1</v></c></row><row r="90000"><c r="A90000"><v>2</v></c></row>',
        "A1:A90000",
      ),
    );
    await expect(assertOfficeArchiveSafe(input)).resolves.toBeUndefined();
  });

  it("does not treat a default column style as populated spreadsheet columns", async () => {
    const xml =
      '<worksheet><dimension ref="A1:A90000"/><cols><col min="1" max="16384" width="12"/></cols><sheetData><row r="90000"><c r="A90000"><v>1</v></c></row></sheetData></worksheet>';
    await expect(assertOfficeArchiveSafe(spreadsheetInput(xml))).resolves.toBeUndefined();
  });

  it.each([
    ['<row r="0"/>', "positive coordinate"],
    ['<row r="1.5"/>', "positive coordinate"],
    ['<row r="99999999999999999999999"/>', "positive coordinate"],
    ['<row r="1"><c r="B2"/></row>', "coordinates disagree"],
    ['<c r="A1"/>', "outside a row"],
    ['<row r="1"><row r="2"/></row>', "nested rows"],
    ['<row r="1"/><row r="1"/>', "increasing"],
    ['<row r="1"><c r="B1"/><c r="A1"/></row>', "increasing"],
  ])("rejects unsafe or ambiguous spreadsheet coordinates: %s", async (contents, message) => {
    await expect(assertOfficeArchiveSafe(spreadsheetInput(sheetXml(contents)))).rejects.toThrow(
      message,
    );
  });

  it.each(["A0", "A1:B2:C3", "a1", "AAAA1", "A1 B2"])(
    "rejects invalid worksheet dimension %s",
    async (dimension) => {
      await expect(
        assertOfficeArchiveSafe(spreadsheetInput(sheetXml("", dimension))),
      ).rejects.toThrow("invalid");
    },
  );

  it("bounds inferred coordinates when row and cell references are omitted", async () => {
    await expect(
      assertOfficeArchiveSafe(spreadsheetInput(sheetXml("<row><c/><c/><c/></row>")), {
        maxSheetCellSpan: 4,
      }),
    ).rejects.toThrow("dense-cell budget");
  });

  it("bounds rectangular area accumulated across individually safe sheets", async () => {
    const input = spreadsheetInput(sheetXml("", "A1:C3"), {
      "xl/worksheets/sheet2.xml": strToU8(sheetXml("", "A1:C3")),
    });
    await expect(
      assertOfficeArchiveSafe(input, { maxSheetCellSpan: 10, maxWorkbookCellSpan: 15 }),
    ).rejects.toThrow("workbook exceeds");
  });

  it("counts worksheet relationships that load the same physical part more than once", async () => {
    const input = spreadsheetInput(sheetXml("", "A1:C3"), {
      "xl/workbook.xml": strToU8(
        '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="One" sheetId="1" r:id="rId1"/><sheet name="Two" sheetId="2" r:id="rId2"/></sheets></workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/><Relationship Id="rId2" Target="/xl/worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
      ),
    });
    await expect(assertOfficeArchiveSafe(input, { maxWorkbookCellSpan: 15 })).rejects.toThrow(
      "workbook exceeds",
    );
    await expect(
      assertOfficeArchiveSafe(input, { maxWorkbookCellSpan: 20 }),
    ).resolves.toBeUndefined();
  });

  it("bounds actual cell count independently of occupied area", async () => {
    await expect(
      assertOfficeArchiveSafe(
        spreadsheetInput(sheetXml('<row r="1"><c r="A1"/><c r="B1"/><c r="C1"/></row>', "A1:C1")),
        { maxWorkbookCells: 2 },
      ),
    ).rejects.toThrow("too many cells");
  });

  it("bounds shared string count including rich strings", async () => {
    const input = spreadsheetInput(sheetXml(""), {
      "xl/sharedStrings.xml": strToU8("<sst><si><t>a</t></si><si><r><t>b</t></r></si></sst>"),
    });
    await expect(assertOfficeArchiveSafe(input, { maxSharedStrings: 1 })).rejects.toThrow(
      "shared strings",
    );
  });

  it.each([
    '<!DOCTYPE worksheet [<!ENTITY payload "abc">]><worksheet>&payload;</worksheet>',
    '<!DOCTYPE worksheet SYSTEM "https://example.invalid/schema.dtd"><worksheet/>',
  ])("rejects DTDs without resolving entities or fetching URLs", async (xml) => {
    await expect(assertOfficeArchiveSafe(spreadsheetInput(xml))).rejects.toThrow(
      "external entities",
    );
  });

  it("bounds XML depth", async () => {
    await expect(
      assertOfficeArchiveSafe(spreadsheetInput("<worksheet><a><b><c/></b></a></worksheet>"), {
        maxXmlDepth: 3,
      }),
    ).rejects.toThrow("structural complexity");
  });

  it.each([
    `<worksheet oversized="${"a".repeat(16385)}"/>`,
    `<worksheet ${Array.from({ length: 129 }, (_, index) => `attr${index}="x"`).join(" ")}/>`,
  ])("bounds XML attributes", async (xml) => {
    await expect(assertOfficeArchiveSafe(spreadsheetInput(xml))).rejects.toThrow(
      "attributes exceed",
    );
  });

  it("retains bounded binary media without attempting UTF-8 or XML parsing", async () => {
    const input = spreadsheetInput(sheetXml(""), {
      "xl/media/image.png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]),
      "custom/readme": strToU8("   not XML"),
      "custom/small": strToU8("a"),
      "custom/empty": new Uint8Array(0),
    });
    await expect(assertOfficeArchiveSafe(input)).resolves.toBeUndefined();
  });

  it("rejects a source that has damaged UTF-8 in a declared XML member", async () => {
    await expect(
      assertOfficeArchiveSafe(
        spreadsheetInput(sheetXml(""), {
          "custom/data.xml": Uint8Array.from([0xff, 0x00, 0x81, 0x81]),
        }),
      ),
    ).rejects.toThrow("cannot be inspected safely");
  });

  it("does not permit local sizes to differ from central-directory sizes", async () => {
    const input = spreadsheetInput(sheetXml(""));
    new DataView(input.body.buffer).setUint32(22, 1, true);
    await expect(assertOfficeArchiveSafe(input)).rejects.toThrow("local entries disagree");
  });

  it("bounds actual inflation even when both size headers understate a member", async () => {
    const input = {
      body: zipSync({ "xl/workbook.xml": strToU8(`<workbook>${"a".repeat(4000)}</workbook>`) }),
      filename: "book.xlsx",
      mimeType: spreadsheetMime,
    };
    const central = Buffer.from(input.body).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const view = new DataView(input.body.buffer);
    view.setUint32(22, 10, true);
    view.setUint32(central + 24, 10, true);
    await expect(assertOfficeArchiveSafe(input)).rejects.toThrow("actual expansion");
  });

  it("detects overstated actual member sizes", async () => {
    const input = {
      body: zipSync({ "xl/workbook.xml": strToU8("<workbook/>") }),
      filename: "book.xlsx",
      mimeType: spreadsheetMime,
    };
    const central = Buffer.from(input.body).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const view = new DataView(input.body.buffer);
    view.setUint32(22, 20, true);
    view.setUint32(central + 24, 20, true);
    await expect(assertOfficeArchiveSafe(input)).rejects.toThrow("actual entry size");
  });

  it("rejects unsupported ZIP compression before starting a decoder", async () => {
    const input = spreadsheetInput(sheetXml(""));
    const central = Buffer.from(input.body).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    new DataView(input.body.buffer).setUint16(central + 10, 99, true);
    await expect(assertOfficeArchiveSafe(input)).rejects.toThrow("compression is unsupported");
  });

  it("bounds XML nodes across parts", async () => {
    await expect(
      assertOfficeArchiveSafe(spreadsheetInput(sheetXml("")), { maxXmlNodes: 2 }),
    ).rejects.toThrow("structural complexity");
  });

  it.each(["<worksheet><row></worksheet>", "<worksheet>", "", "<worksheet/><worksheet/>"])(
    "rejects incomplete or structurally ambiguous XML %s",
    async (xml) => {
      await expect(assertOfficeArchiveSafe(spreadsheetInput(xml))).rejects.toThrow(
        OfficeArchiveAdmissionError,
      );
    },
  );

  it("rejects unsupported XML encodings explicitly", async () => {
    await expect(
      assertOfficeArchiveSafe(
        spreadsheetInput('<?xml version="1.0" encoding="ISO-8859-1"?><worksheet/>'),
      ),
    ).rejects.toThrow("encoding is unsupported");
  });

  it("bounds per-part declared XML bytes before decompression", async () => {
    await expect(
      assertOfficeArchiveSafe(spreadsheetInput(sheetXml("")), { maxXmlEntryBytes: 20 }),
    ).rejects.toThrow("XML part");
  });

  it("bounds aggregate actual XML bytes", async () => {
    await expect(
      assertOfficeArchiveSafe(spreadsheetInput(sheetXml("")), { maxXmlBytes: 200 }),
    ).rejects.toThrow("XML expansion");
  });

  it("bounds archive bytes including non-XML media", async () => {
    const input = spreadsheetInput(sheetXml(""), { "xl/media/image.png": new Uint8Array(600) });
    await expect(assertOfficeArchiveSafe(input, { maxArchiveBytes: 700 })).rejects.toThrow(
      "actual expansion",
    );
  });

  it("bounds entries before allocating extracted data", async () => {
    await expect(
      assertOfficeArchiveSafe(spreadsheetInput(sheetXml("")), { maxEntries: 2 }),
    ).rejects.toThrow("too many entries");
  });

  it.each([
    "../outside.xml",
    "word/../outside.xml",
    "word\\document.xml",
    "/absolute.xml",
    "nul\0.xml",
    "word/./document.xml",
  ])("rejects ambiguous archive path %s", async (name) => {
    await expect(
      assertOfficeArchiveSafe(spreadsheetInput(sheetXml(""), { [name]: strToU8("<a/>") })),
    ).rejects.toThrow("entry names");
  });

  it("rejects case-ambiguous part names", async () => {
    await expect(
      assertOfficeArchiveSafe(
        spreadsheetInput(sheetXml(""), { "XL/WORKBOOK.XML": strToU8("<workbook/>") }),
      ),
    ).rejects.toThrow("entry names");
  });

  it.each([ZipDeflate, ZipPassThrough])(
    "accepts lawful streamed ZIP data descriptors (%s)",
    async (Member) => {
      const chunks: Uint8Array[] = [];
      const archive = new Zip((error, chunk) => {
        if (error) throw error;
        chunks.push(chunk);
      });
      const member = new Member("xl/worksheets/sheet1.xml");
      archive.add(member);
      const xml = strToU8(sheetXml('<row r="1"><c r="A1"><v>1</v></c></row>'));
      member.push(xml.subarray(0, 15), false);
      member.push(xml.subarray(15), true);
      archive.end();
      await expect(
        assertOfficeArchiveSafe({
          body: Buffer.concat(chunks),
          filename: "streamed.xlsx",
          mimeType: spreadsheetMime,
        }),
      ).resolves.toBeUndefined();
    },
  );

  it("retains cancellation reason without wrapping it as an input failure", async () => {
    const controller = new AbortController();
    const reason = new Error("lease lost");
    controller.abort(reason);
    await expect(
      assertOfficeArchiveSafe({ ...spreadsheetInput(sheetXml("")), signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("yields while inspecting so cancellation can stop further decompression", async () => {
    const controller = new AbortController();
    const reason = new Error("client disconnected");
    const body = zipSync(
      {
        "xl/workbook.xml": strToU8("<workbook/>"),
        "xl/media/image.png": new Uint8Array(128 * 1024),
      },
      { level: 0 },
    );
    const timer = setTimeout(() => controller.abort(reason), 0);
    try {
      await expect(
        assertOfficeArchiveSafe({
          body,
          filename: "large.xlsx",
          mimeType: spreadsheetMime,
          signal: controller.signal,
        }),
      ).rejects.toBe(reason);
    } finally {
      clearTimeout(timer);
    }
  });

  it("bounds inspection time independently of provider timeouts", async () => {
    const input = spreadsheetInput(sheetXml(""));
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(2);
    try {
      await expect(assertOfficeArchiveSafe(input, { timeoutMs: 1 })).rejects.toThrow(
        "processing time",
      );
    } finally {
      clock.mockRestore();
    }
  });

  it("ignores non-Office inputs and unrelated ZIP archives", async () => {
    await expect(
      assertOfficeArchiveSafe({
        body: strToU8("hello"),
        filename: "note.txt",
        mimeType: "text/plain",
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertOfficeArchiveSafe({
        body: zipSync({ "notes.txt": strToU8("hello") }),
        filename: "archive.zip",
        mimeType: "application/zip",
      }),
    ).resolves.toBeUndefined();
  });

  it.each([new Uint8Array([1, 2, 3]), new Uint8Array([0x50, 0x4b]), zipSync({})])(
    "rejects Office containers that cannot be inspected",
    async (body) => {
      await expect(
        assertOfficeArchiveSafe({ body, filename: "broken.xlsx", mimeType: spreadsheetMime }),
      ).rejects.toThrow(OfficeArchiveAdmissionError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid programmer-supplied limits %s",
    async (value) => {
      await expect(
        assertOfficeArchiveSafe(spreadsheetInput(sheetXml("")), { maxEntries: value }),
      ).rejects.toThrow("positive safe integer");
    },
  );
});
