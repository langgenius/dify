import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { type ParseDocumentInput, ProviderInputError } from "@knowledge/parsers";
import { afterEach, describe, expect, it } from "vitest";

import { createPdfParserPreflight } from "./pdf-parser-preflight";

const directories: string[] = [];
const pdfInput = (overrides: Partial<ParseDocumentInput> = {}): ParseDocumentInput => ({
  body: new TextEncoder().encode("%PDF-1.7\n"),
  documentAssetId: "asset-pdf",
  filename: "document.pdf",
  mimeType: "application/pdf",
  version: 1,
  ...overrides,
});

function pageInfo(width: number, height: number, page = 1): string {
  return `Page ${page} size: ${width} x ${height} pts\nPage ${page} MediaBox: 0 0 ${width} ${height}\nPage ${page} CropBox: 0 0 ${width} ${height}\n`;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pdf-preflight-test-"));
  directories.push(directory);
  return directory;
}

async function executableFixture(
  source: string,
): Promise<{ directory: string; executable: string }> {
  const directory = await temporaryDirectory();
  const executable = join(directory, "pdfinfo-fixture");
  await writeFile(executable, `#!${process.execPath}\n${source}`, { mode: 0o700 });
  return { directory, executable };
}

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new Error("Fixture child did not start");
}

function syntheticPdf({
  pages,
  inherited = false,
}: { pages: readonly [number, number][]; inherited?: boolean }): Uint8Array {
  const firstPage = pages[0] ?? [595, 842];
  const box = ([width, height]: readonly [number, number]) =>
    `/MediaBox [0 0 ${width} ${height}] /CropBox [0 0 ${width} ${height}]`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${index + 3} 0 R`).join(" ")}] /Count ${pages.length} ${inherited ? box(firstPage) : ""} >>`,
    ...pages.map((page) => `<< /Type /Page /Parent 2 0 R ${inherited ? "" : box(page)} >>`),
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("PDF raster preflight", () => {
  it.each([
    [595.28, 841.89],
    [841.89, 1190.55],
  ])("admits ordinary %s by %s point pages", async (width, height) => {
    const preflight = createPdfParserPreflight({
      executePdfinfo: async () => `Pages: 1\n${pageInfo(width, height)}`,
    });
    await expect(preflight.check(pdfInput())).resolves.toBeUndefined();
  });

  it("rejects an 80 by 180 cm banner despite its tiny file body", async () => {
    const preflight = createPdfParserPreflight({
      executePdfinfo: async () => `Pages: 1\n${pageInfo(2267.72, 5102.36)}`,
    });
    await expect(preflight.check(pdfInput())).rejects.toMatchObject({
      code: "provider_input",
      retryable: false,
      message: expect.stringContaining("page 1"),
    });
  });

  it("checks every page, including an oversized page after a normal first page", async () => {
    const preflight = createPdfParserPreflight({
      executePdfinfo: async () => `Pages: 2\n${pageInfo(595, 842)}${pageInfo(2267, 5102, 2)}`,
    });
    await expect(preflight.check(pdfInput())).rejects.toThrow("page 2");
  });

  it("uses the conservative MediaBox even when page size and CropBox are small", async () => {
    const output = `Pages: 1\n${pageInfo(595, 842).replace("MediaBox: 0 0 595 842", "MediaBox: -1000 0 2267 5102")}`;
    await expect(
      createPdfParserPreflight({ executePdfinfo: async () => output }).check(pdfInput()),
    ).rejects.toBeInstanceOf(ProviderInputError);
  });

  it("also bounds single-edge length when the total pixel area is small", async () => {
    await expect(
      createPdfParserPreflight({
        executePdfinfo: async () => `Pages: 1\n${pageInfo(3000, 1)}`,
      }).check(pdfInput()),
    ).rejects.toBeInstanceOf(ProviderInputError);
  });

  it("bounds total pixel area even when both individual edges fit", async () => {
    await expect(
      createPdfParserPreflight({
        executePdfinfo: async () => `Pages: 1\n${pageInfo(1190.55, 1683.78)}`,
      }).check(pdfInput()),
    ).rejects.toBeInstanceOf(ProviderInputError);
  });

  it("checks the CropBox independently of the page size and MediaBox", async () => {
    const output = `Pages: 1\n${pageInfo(595, 842).replace("CropBox: 0 0 595 842", "CropBox: 0 0 2267 5102")}`;
    await expect(
      createPdfParserPreflight({ executePdfinfo: async () => output }).check(pdfInput()),
    ).rejects.toBeInstanceOf(ProviderInputError);
  });

  it.each([
    "Pages: 0\n",
    "Pages: 10001\n",
    `Pages: 1\nPages: 1\n${pageInfo(595, 842)}`,
    `Pages: 2\n${pageInfo(595, 842)}`,
    `Pages: 1\n${pageInfo(595, 842)}${pageInfo(595, 842)}`,
    `Pages: 1\n${pageInfo(595, 842, 2)}`,
    `Pages: 1\n${pageInfo(595, 842).replace(/Page 1 CropBox:.*\n/, "")}`,
    `Pages: 1\n${pageInfo(Number.NaN, 842)}`,
    `Pages: 1\n${pageInfo(Number.POSITIVE_INFINITY, 842)}`,
    `Pages: 1\n${pageInfo(-595, 842)}`,
    `Pages: 1\n${pageInfo(0, 842)}`,
    `Pages: 1\n${pageInfo(595, 842).replace("size: 595 x 842 pts", "size: invalid")}`,
    `Pages: 1\n${pageInfo(595, 842).replace("CropBox: 0 0 595 842", "CropBox: 0 0 595")}`,
    `Pages: 1\n${pageInfo(595, 842).replace("MediaBox: 0 0 595 842", "MediaBox: 10 0 0 842")}`,
    "Encrypted: yes\n",
  ])("fails closed for incomplete, duplicate or invalid geometry: %s", async (output) => {
    await expect(
      createPdfParserPreflight({ executePdfinfo: async () => output }).check(pdfInput()),
    ).rejects.toBeInstanceOf(ProviderInputError);
  });

  it.each([
    { filename: "document.bin", mimeType: "application/pdf", body: new Uint8Array() },
    { filename: "DOCUMENT.PDF", mimeType: "application/octet-stream", body: new Uint8Array() },
    {
      filename: "document.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: new TextEncoder().encode("garbage\n%PDF-1.7\n"),
    },
  ])("applies the PDF guard if any identity signal identifies a PDF", async (identity) => {
    await expect(
      createPdfParserPreflight({
        executePdfinfo: async () => `Pages: 1\n${pageInfo(2267, 5102)}`,
      }).check(pdfInput(identity)),
    ).rejects.toBeInstanceOf(ProviderInputError);
  });

  it("performs no filesystem or subprocess I/O for non-PDF documents", async () => {
    const preflight = createPdfParserPreflight({
      temporaryDirectory: "/does-not-exist/pdf-preflight",
      executePdfinfo: async () => {
        throw new Error("must not execute");
      },
    });
    await expect(
      preflight.check(
        pdfInput({
          filename: "document.docx",
          mimeType: "application/octet-stream",
          body: new TextEncoder().encode("PK"),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([{ timeoutMs: 0 }, { timeoutMs: Number.NaN }, { maxOutputBytes: -1 }])(
    "refuses invalid inspection limits: %s",
    (options) => {
      expect(() => createPdfParserPreflight(options)).toThrow("must be a positive safe integer");
    },
  );

  it("writes the input privately and cleans it up after successful checking", async () => {
    const directory = await temporaryDirectory();
    const input = pdfInput();
    const preflight = createPdfParserPreflight({
      temporaryDirectory: directory,
      executePdfinfo: async ({ path }) => {
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(await readFile(path)).toEqual(Buffer.from(input.body));
        return `Pages: 1\n${pageInfo(595, 842)}`;
      },
    });
    await preflight.check(input);
    expect(await readdir(directory)).toEqual([]);
  });

  it("cleans up its private temporary input when geometry is rejected", async () => {
    const directory = await temporaryDirectory();
    await expect(
      createPdfParserPreflight({
        temporaryDirectory: directory,
        executePdfinfo: async () => "invalid",
      }).check(pdfInput()),
    ).rejects.toBeInstanceOf(ProviderInputError);
    expect(await readdir(directory)).toEqual([]);
  });

  it("fails clearly when pdfinfo is missing, rather than silently bypassing the guard", async () => {
    const directory = await temporaryDirectory();
    await expect(
      createPdfParserPreflight({
        temporaryDirectory: directory,
        pdfinfoExecutable: join(directory, "missing"),
      }).check(pdfInput()),
    ).rejects.toThrow("requires the pdfinfo executable");
    expect(await readdir(directory)).toEqual([]);
  });

  it("preserves an already-aborted parent reason without doing I/O", async () => {
    const controller = new AbortController();
    const reason = new Error("lease expired");
    controller.abort(reason);
    await expect(
      createPdfParserPreflight({ temporaryDirectory: "/does-not-exist/pdf-preflight" }).check(
        pdfInput({ signal: controller.signal }),
      ),
    ).rejects.toBe(reason);
  });

  it("kills the actual subprocess and cleans up when the parent is cancelled", async () => {
    const { directory, executable } = await executableFixture(
      `const fs = require('node:fs');\nfs.writeFileSync(__dirname + '/child.pid', String(process.pid));\nsetInterval(() => {}, 1000);`,
    );
    const controller = new AbortController();
    const reason = new Error("lease lost");
    const result = createPdfParserPreflight({
      temporaryDirectory: directory,
      pdfinfoExecutable: executable,
    }).check(pdfInput({ signal: controller.signal }));
    const rejected = expect(result).rejects.toBe(reason);
    const pid = Number(await waitForFile(join(directory, "child.pid")));
    controller.abort(reason);
    await rejected;
    expect(() => process.kill(pid, 0)).toThrow();
    expect((await readdir(directory)).sort()).toEqual(["child.pid", "pdfinfo-fixture"]);
  });

  it("kills timed-out subprocesses even when they ignore SIGTERM, then cleans up", async () => {
    const { directory, executable } = await executableFixture(
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
    );
    await expect(
      createPdfParserPreflight({
        temporaryDirectory: directory,
        pdfinfoExecutable: executable,
        timeoutMs: 100,
      }).check(pdfInput()),
    ).rejects.toBeInstanceOf(ProviderInputError);
    expect(await readdir(directory)).toEqual(["pdfinfo-fixture"]);
  });

  it("bounds subprocess stdout and cleans up after output overflow", async () => {
    const { directory, executable } = await executableFixture(
      "process.stdout.write('a'.repeat(4096)); setInterval(() => {}, 1000);",
    );
    await expect(
      createPdfParserPreflight({
        temporaryDirectory: directory,
        pdfinfoExecutable: executable,
        maxOutputBytes: 64,
      }).check(pdfInput()),
    ).rejects.toBeInstanceOf(ProviderInputError);
    expect(await readdir(directory)).toEqual(["pdfinfo-fixture"]);
  });

  it("rejects a real subprocess parse failure without exposing its stderr", async () => {
    const { directory, executable } = await executableFixture(
      "process.stderr.write('private-document-text'); process.exit(1);",
    );
    const result = createPdfParserPreflight({
      temporaryDirectory: directory,
      pdfinfoExecutable: executable,
    }).check(pdfInput());
    await expect(result).rejects.toThrow("Unable to safely inspect PDF");
    await expect(result).rejects.not.toThrow("private-document-text");
    expect(await readdir(directory)).toEqual(["pdfinfo-fixture"]);
  });

  it("uses real Poppler to resolve inherited boxes and detect later oversized pages", async () => {
    await promisify(execFile)("pdfinfo", ["-v"]);
    const preflight = createPdfParserPreflight();
    await expect(
      preflight.check(
        pdfInput({
          body: syntheticPdf({
            pages: [
              [595, 842],
              [595, 842],
            ],
            inherited: true,
          }),
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      preflight.check(
        pdfInput({
          body: syntheticPdf({
            pages: [
              [595, 842],
              [2267, 5102],
            ],
          }),
        }),
      ),
    ).rejects.toThrow("page 2");
  });
});
