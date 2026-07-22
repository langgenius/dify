import type { HybridRetrievalItem } from "./retrieval-fusion";

export interface DocumentOutlineLocalizationExpectation {
  readonly expectedPageNumber?: number | undefined;
  readonly expectedSectionPath: readonly string[];
  readonly id: string;
  readonly nodeId: string;
}

export interface DocumentOutlineLocalizationItem {
  readonly expectedPageHit?: boolean | undefined;
  readonly expectedSectionHit: boolean;
  readonly id: string;
  readonly nodeId: string;
  readonly observedPageNumber?: number | undefined;
  readonly observedSectionPath: readonly string[];
  readonly status: "hit" | "miss" | "missing";
}

export interface DocumentOutlineLocalizationReport {
  readonly items: readonly DocumentOutlineLocalizationItem[];
  readonly metrics: {
    readonly missingRate: number;
    readonly pageHitRate: number | null;
    readonly sectionHitRate: number;
  };
  readonly strategyVersion: "document-outline-localization-eval-v1";
}

export function evaluateDocumentOutlineLocalization({
  expectations,
  items,
}: {
  readonly expectations: readonly DocumentOutlineLocalizationExpectation[];
  readonly items: readonly HybridRetrievalItem[];
}): DocumentOutlineLocalizationReport {
  const itemsByNodeId = new Map(items.map((item) => [item.nodeId, item]));
  const evaluated = expectations.map((expectation): DocumentOutlineLocalizationItem => {
    const item = itemsByNodeId.get(expectation.nodeId);

    if (!item) {
      return {
        expectedSectionHit: false,
        id: expectation.id,
        nodeId: expectation.nodeId,
        observedSectionPath: [],
        status: "missing",
      };
    }

    const observedSectionPath = observedOutlineSectionPath(item) ?? item.citation.sectionPath;
    const observedPageNumber = observedOutlinePageNumber(item) ?? item.citation.pageNumber;
    const expectedSectionHit = sectionPathEquals(
      observedSectionPath,
      expectation.expectedSectionPath,
    );
    const expectedPageHit =
      expectation.expectedPageNumber === undefined
        ? undefined
        : observedPageNumber === expectation.expectedPageNumber;

    return {
      ...(expectedPageHit === undefined ? {} : { expectedPageHit }),
      expectedSectionHit,
      id: expectation.id,
      nodeId: expectation.nodeId,
      ...(observedPageNumber === undefined ? {} : { observedPageNumber }),
      observedSectionPath,
      status:
        expectedSectionHit && (expectedPageHit === undefined || expectedPageHit) ? "hit" : "miss",
    };
  });
  const pageExpectations = evaluated.filter((item) => item.expectedPageHit !== undefined);

  return {
    items: evaluated,
    metrics: {
      missingRate: ratio(
        evaluated.filter((item) => item.status === "missing").length,
        evaluated.length,
      ),
      pageHitRate:
        pageExpectations.length === 0
          ? null
          : ratio(
              pageExpectations.filter((item) => item.expectedPageHit === true).length,
              pageExpectations.length,
            ),
      sectionHitRate: ratio(
        evaluated.filter((item) => item.expectedSectionHit).length,
        evaluated.length,
      ),
    },
    strategyVersion: "document-outline-localization-eval-v1",
  };
}

function observedOutlineSectionPath(item: HybridRetrievalItem): readonly string[] | undefined {
  const outline = item.metadata.documentOutline;

  if (!isRecord(outline)) {
    return undefined;
  }

  const sectionPath = outline.sectionPath;

  return Array.isArray(sectionPath)
    ? sectionPath.filter((segment): segment is string => typeof segment === "string")
    : undefined;
}

function observedOutlinePageNumber(item: HybridRetrievalItem): number | undefined {
  const outline = item.metadata.documentOutline;

  if (!isRecord(outline)) {
    return undefined;
  }

  return typeof outline.startPage === "number" ? outline.startPage : undefined;
}

function sectionPathEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return Math.round((numerator / denominator) * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
