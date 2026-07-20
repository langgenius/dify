import { describe, expect, it } from "vitest";

import {
  SourceProviderUnavailableError,
  createStaticSourceProviderCatalog,
  requireAvailableSourceProvider,
} from "./source-provider-catalog";

describe("source provider catalog", () => {
  it("returns cloned, stable descriptors and preserves honest availability", async () => {
    const catalog = createStaticSourceProviderCatalog([
      {
        authKinds: ["endpoint"],
        available: false,
        capabilities: ["online-drive"],
        configuration: [],
        displayName: "Unavailable drive",
        id: "drive-a",
        unavailableReason: "not configured",
      },
      {
        authKinds: ["oauth2"],
        available: true,
        capabilities: ["online-document"],
        configuration: [
          {
            format: "password",
            name: "clientSecret",
            required: true,
            secret: true,
            type: "string",
          },
        ],
        displayName: "Documents",
        id: "documents-a",
      },
    ]);
    const listed = await catalog.list();
    expect(listed.map((provider) => provider.id)).toEqual(["documents-a", "drive-a"]);
    (listed[0]?.authKinds as string[] | undefined)?.push("endpoint");
    expect((await catalog.get("documents-a"))?.authKinds).toEqual(["oauth2"]);
    await expect(requireAvailableSourceProvider(catalog, "drive-a")).rejects.toBeInstanceOf(
      SourceProviderUnavailableError,
    );
    await expect(
      requireAvailableSourceProvider(catalog, "documents-a", "online-drive"),
    ).rejects.toBeInstanceOf(SourceProviderUnavailableError);
  });

  it("rejects duplicate ids and secret fields that are not password-shaped", () => {
    const descriptor = {
      authKinds: ["endpoint" as const],
      available: true,
      capabilities: ["website-crawl" as const],
      configuration: [],
      displayName: "Website",
      id: "website-a",
    };
    expect(() => createStaticSourceProviderCatalog([descriptor, descriptor])).toThrow(/Duplicate/u);
    expect(() =>
      createStaticSourceProviderCatalog([
        {
          ...descriptor,
          configuration: [
            {
              name: "token",
              required: true,
              secret: true,
              type: "string" as const,
            },
          ],
        },
      ]),
    ).toThrow(/password format/u);
  });
});
