import { createHash } from "node:crypto";

import type { KnowledgeSpace } from "@knowledge/core";

import {
  type CreateKnowledgeSpaceInput,
  DuplicateKnowledgeSpaceSlugError,
  type KnowledgeSpaceRepository,
} from "./knowledge-space-repository";

export const MAX_GENERATED_KNOWLEDGE_SPACE_SLUG_ATTEMPTS = 100;
const MAX_KNOWLEDGE_SPACE_SLUG_LENGTH = 160;

export interface CreateKnowledgeSpaceWithOptionalSlugInput
  extends Omit<CreateKnowledgeSpaceInput, "slug"> {
  readonly slug?: string | undefined;
}

/**
 * Creates an ASCII-only URL slug from the display name. Names without an ASCII transliteration
 * use a deterministic digest rather than collapsing every non-Latin name to the same slug.
 */
export function generateKnowledgeSpaceSlug(name: string): string {
  const normalizedName = name.normalize("NFC").trim();
  const asciiSlug = normalizedName
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_KNOWLEDGE_SPACE_SLUG_LENGTH)
    .replace(/-+$/gu, "");

  if (asciiSlug) {
    return asciiSlug;
  }

  const digest = createHash("sha256").update(normalizedName).digest("hex").slice(0, 12);
  return `knowledge-space-${digest}`;
}

/**
 * Explicit slugs remain strict and conflict with 409 semantics. Generated slugs retry a bounded,
 * deterministic suffix sequence so concurrent or repeated names cannot spin forever.
 */
export async function createKnowledgeSpaceWithOptionalSlug(
  spaces: KnowledgeSpaceRepository,
  input: CreateKnowledgeSpaceWithOptionalSlugInput,
): Promise<KnowledgeSpace> {
  return createWithOptionalKnowledgeSpaceSlug(input, (candidate) => spaces.create(candidate));
}

/** Shared bounded slug allocation for both legacy repositories and atomic provisioning. */
export async function createWithOptionalKnowledgeSpaceSlug<T>(
  input: CreateKnowledgeSpaceWithOptionalSlugInput,
  create: (input: CreateKnowledgeSpaceInput) => Promise<T>,
): Promise<T> {
  if (input.slug !== undefined) {
    return create({ ...input, slug: input.slug });
  }

  const baseSlug = generateKnowledgeSpaceSlug(input.name);
  for (let attempt = 0; attempt < MAX_GENERATED_KNOWLEDGE_SPACE_SLUG_ATTEMPTS; attempt += 1) {
    try {
      return await create({
        ...input,
        slug: generatedSlugCandidate(baseSlug, attempt),
      });
    } catch (error) {
      if (!(error instanceof DuplicateKnowledgeSpaceSlugError)) {
        throw error;
      }
    }
  }

  throw new DuplicateKnowledgeSpaceSlugError();
}

function generatedSlugCandidate(baseSlug: string, attempt: number): string {
  if (attempt === 0) {
    return baseSlug;
  }

  const suffix = `-${attempt + 1}`;
  const truncatedBase = baseSlug
    .slice(0, MAX_KNOWLEDGE_SPACE_SLUG_LENGTH - suffix.length)
    .replace(/-+$/gu, "");
  return `${truncatedBase}${suffix}`;
}
