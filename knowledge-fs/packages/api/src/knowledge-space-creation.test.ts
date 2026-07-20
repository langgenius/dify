import { describe, expect, it } from "vitest";

import {
  MAX_GENERATED_KNOWLEDGE_SPACE_SLUG_ATTEMPTS,
  createKnowledgeSpaceWithOptionalSlug,
  generateKnowledgeSpaceSlug,
} from "./knowledge-space-creation";
import {
  DuplicateKnowledgeSpaceSlugError,
  createInMemoryKnowledgeSpaceRepository,
} from "./knowledge-space-repository";

describe("knowledge-space creation", () => {
  it("derives stable safe slugs for Latin and non-Latin display names", () => {
    expect(generateKnowledgeSpaceSlug("  Crème brûlée & Camera  ")).toBe("creme-brulee-camera");
    expect(generateKnowledgeSpaceSlug("Cafe\u0301")).toBe(generateKnowledgeSpaceSlug("  Café  "));

    const nonLatinSlug = generateKnowledgeSpaceSlug("相机技术规范");
    expect(nonLatinSlug).toMatch(/^knowledge-space-[0-9a-f]{12}$/u);
    expect(generateKnowledgeSpaceSlug("相机技术规范")).toBe(nonLatinSlug);
    expect(generateKnowledgeSpaceSlug("  相机技术规范\n")).toBe(nonLatinSlug);
    expect(generateKnowledgeSpaceSlug("\u1112\u1161\u11ab")).toBe(generateKnowledgeSpaceSlug("한"));
    expect(generateKnowledgeSpaceSlug("产品技术规范")).not.toBe(nonLatinSlug);
  });

  it("uses bounded deterministic suffixes for generated tenant conflicts", async () => {
    const repository = createInMemoryKnowledgeSpaceRepository({
      maxListLimit: 100,
      maxSpaces: 100,
    });

    const first = await createKnowledgeSpaceWithOptionalSlug(repository, {
      name: "Camera Technical Spec",
      tenantId: "tenant-1",
    });
    const second = await createKnowledgeSpaceWithOptionalSlug(repository, {
      name: "Camera Technical Spec",
      tenantId: "tenant-1",
    });
    const otherTenant = await createKnowledgeSpaceWithOptionalSlug(repository, {
      name: "Camera Technical Spec",
      tenantId: "tenant-2",
    });

    expect(first.slug).toBe("camera-technical-spec");
    expect(second.slug).toBe("camera-technical-spec-2");
    expect(otherTenant.slug).toBe("camera-technical-spec");
  });

  it("preserves explicit slug conflicts and stops generated retries at the bound", async () => {
    const base = createInMemoryKnowledgeSpaceRepository({
      maxListLimit: 100,
      maxSpaces: 100,
    });
    let attempts = 0;
    const alwaysConflicting = {
      ...base,
      create: async () => {
        attempts += 1;
        throw new DuplicateKnowledgeSpaceSlugError();
      },
    };

    await expect(
      createKnowledgeSpaceWithOptionalSlug(alwaysConflicting, {
        name: "Generated",
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(DuplicateKnowledgeSpaceSlugError);
    expect(attempts).toBe(MAX_GENERATED_KNOWLEDGE_SPACE_SLUG_ATTEMPTS);

    attempts = 0;
    await expect(
      createKnowledgeSpaceWithOptionalSlug(alwaysConflicting, {
        name: "Explicit",
        slug: "explicit",
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(DuplicateKnowledgeSpaceSlugError);
    expect(attempts).toBe(1);
  });

  it("keeps generated candidates within the persisted slug length", async () => {
    const repository = createInMemoryKnowledgeSpaceRepository({
      maxListLimit: 100,
      maxSpaces: 100,
    });
    const name = "a".repeat(160);

    await createKnowledgeSpaceWithOptionalSlug(repository, { name, tenantId: "tenant-1" });
    const suffixed = await createKnowledgeSpaceWithOptionalSlug(repository, {
      name,
      tenantId: "tenant-1",
    });

    expect(suffixed.slug).toHaveLength(160);
    expect(suffixed.slug.endsWith("-2")).toBe(true);
  });
});
