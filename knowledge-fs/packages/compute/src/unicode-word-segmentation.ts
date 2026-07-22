import extendedPictographicRanges from "@unicode/unicode-17.0.0/Binary_Property/Extended_Pictographic/ranges.js";
import aLetterRanges from "@unicode/unicode-17.0.0/Word_Break/ALetter/ranges.js";
import carriageReturnRanges from "@unicode/unicode-17.0.0/Word_Break/CR/ranges.js";
import doubleQuoteRanges from "@unicode/unicode-17.0.0/Word_Break/Double_Quote/ranges.js";
import extendRanges from "@unicode/unicode-17.0.0/Word_Break/Extend/ranges.js";
import extendNumLetRanges from "@unicode/unicode-17.0.0/Word_Break/ExtendNumLet/ranges.js";
import formatRanges from "@unicode/unicode-17.0.0/Word_Break/Format/ranges.js";
import hebrewLetterRanges from "@unicode/unicode-17.0.0/Word_Break/Hebrew_Letter/ranges.js";
import katakanaRanges from "@unicode/unicode-17.0.0/Word_Break/Katakana/ranges.js";
import lineFeedRanges from "@unicode/unicode-17.0.0/Word_Break/LF/ranges.js";
import midLetterRanges from "@unicode/unicode-17.0.0/Word_Break/MidLetter/ranges.js";
import midNumRanges from "@unicode/unicode-17.0.0/Word_Break/MidNum/ranges.js";
import midNumLetRanges from "@unicode/unicode-17.0.0/Word_Break/MidNumLet/ranges.js";
import newlineRanges from "@unicode/unicode-17.0.0/Word_Break/Newline/ranges.js";
import numericRanges from "@unicode/unicode-17.0.0/Word_Break/Numeric/ranges.js";
import regionalIndicatorRanges from "@unicode/unicode-17.0.0/Word_Break/Regional_Indicator/ranges.js";
import singleQuoteRanges from "@unicode/unicode-17.0.0/Word_Break/Single_Quote/ranges.js";
import wordSegmentSpaceRanges from "@unicode/unicode-17.0.0/Word_Break/WSegSpace/ranges.js";
import zeroWidthJoinerRanges from "@unicode/unicode-17.0.0/Word_Break/ZWJ/ranges.js";
import { isAlphanumeric } from "unicode-segmenter/general";

interface UnicodeRange {
  readonly begin: number;
  readonly end: number;
}

interface CategorizedRange extends UnicodeRange {
  readonly category: WordBreakCategory;
}

enum WordBreakCategory {
  Other = 0,
  LineFeed = 1,
  Newline = 2,
  CarriageReturn = 3,
  WordSegmentSpace = 4,
  DoubleQuote = 5,
  SingleQuote = 6,
  MidNum = 7,
  MidNumLet = 8,
  Numeric = 9,
  MidLetter = 10,
  ALetter = 11,
  ExtendNumLet = 12,
  Format = 13,
  Extend = 14,
  HebrewLetter = 15,
  ZeroWidthJoiner = 16,
  Katakana = 17,
  RegionalIndicator = 18,
  StartOfText = 19,
  EndOfText = 20,
}

const categorizedRanges: CategorizedRange[] = [
  ...categorize(aLetterRanges, WordBreakCategory.ALetter),
  ...categorize(carriageReturnRanges, WordBreakCategory.CarriageReturn),
  ...categorize(doubleQuoteRanges, WordBreakCategory.DoubleQuote),
  ...categorize(extendRanges, WordBreakCategory.Extend),
  ...categorize(extendNumLetRanges, WordBreakCategory.ExtendNumLet),
  ...categorize(formatRanges, WordBreakCategory.Format),
  ...categorize(hebrewLetterRanges, WordBreakCategory.HebrewLetter),
  ...categorize(katakanaRanges, WordBreakCategory.Katakana),
  ...categorize(lineFeedRanges, WordBreakCategory.LineFeed),
  ...categorize(midLetterRanges, WordBreakCategory.MidLetter),
  ...categorize(midNumRanges, WordBreakCategory.MidNum),
  ...categorize(midNumLetRanges, WordBreakCategory.MidNumLet),
  ...categorize(newlineRanges, WordBreakCategory.Newline),
  ...categorize(numericRanges, WordBreakCategory.Numeric),
  ...categorize(regionalIndicatorRanges, WordBreakCategory.RegionalIndicator),
  ...categorize(singleQuoteRanges, WordBreakCategory.SingleQuote),
  ...categorize(wordSegmentSpaceRanges, WordBreakCategory.WordSegmentSpace),
  ...categorize(zeroWidthJoinerRanges, WordBreakCategory.ZeroWidthJoiner),
].sort((left, right) => left.begin - right.begin);

/** Unicode 17 UAX #29 default word segmentation, bounded by the requested output size. */
export function tokenizeUnicodeWords(text: string, limit: number): string[] {
  const words: string[] = [];
  let previousBoundary: number | undefined;
  for (const boundary of findWordBoundaries(text)) {
    if (previousBoundary !== undefined) {
      const span = text.slice(previousBoundary, boundary);
      if (containsAlphanumeric(span)) {
        words.push(span);
        if (words.length >= limit) break;
      }
    }
    previousBoundary = boundary;
  }
  return words;
}

/** Returns every default word-bound span; exposed for Unicode conformance verification. */
export function segmentUnicodeWordBounds(text: string): string[] {
  const segments: string[] = [];
  let previousBoundary: number | undefined;
  for (const boundary of findWordBoundaries(text)) {
    if (previousBoundary !== undefined) segments.push(text.slice(previousBoundary, boundary));
    previousBoundary = boundary;
  }
  return segments;
}

function* findWordBoundaries(text: string): Generator<number, void, void> {
  if (text.length === 0) return;

  let rightPosition = 0;
  let lookaheadPosition = 0;
  let lookbehind = WordBreakCategory.StartOfText;
  let left = WordBreakCategory.StartOfText;
  let right = WordBreakCategory.StartOfText;
  let lookahead = categoryAt(text, 0);
  let consecutiveRegionalIndicators = 0;

  do {
    rightPosition = lookaheadPosition;
    lookaheadPosition = positionAfter(text, lookaheadPosition);
    [lookbehind, left, right, lookahead] = [
      left,
      right,
      lookahead,
      categoryAt(text, lookaheadPosition),
    ];

    if (left === WordBreakCategory.StartOfText) {
      consecutiveRegionalIndicators = right === WordBreakCategory.RegionalIndicator ? 1 : 0;
      yield rightPosition;
      continue;
    }
    if (right === WordBreakCategory.EndOfText) {
      yield rightPosition;
      break;
    }
    if (left === WordBreakCategory.CarriageReturn && right === WordBreakCategory.LineFeed) {
      continue;
    }
    if (isNewline(left) || isNewline(right)) {
      yield rightPosition;
      continue;
    }

    const pictographicAfterJoiner = findPictographicAfterJoiner(
      text,
      rightPosition,
      right,
      lookaheadPosition,
    );
    if (pictographicAfterJoiner !== undefined) {
      rightPosition = pictographicAfterJoiner;
      lookaheadPosition = positionAfter(text, pictographicAfterJoiner);
      [left, right, lookahead] = [
        WordBreakCategory.ZeroWidthJoiner,
        categoryAt(text, rightPosition),
        categoryAt(text, lookaheadPosition),
      ];
    }

    if (
      left === WordBreakCategory.ZeroWidthJoiner &&
      isInRanges(text.codePointAt(rightPosition) as number, extendedPictographicRanges)
    ) {
      continue;
    }
    if (
      left === WordBreakCategory.WordSegmentSpace &&
      right === WordBreakCategory.WordSegmentSpace
    ) {
      continue;
    }

    while (isIgnored(right)) {
      rightPosition = lookaheadPosition;
      lookaheadPosition = positionAfter(text, lookaheadPosition);
      [right, lookahead] = [lookahead, categoryAt(text, lookaheadPosition)];
    }
    if (right === WordBreakCategory.EndOfText) {
      yield rightPosition;
      break;
    }
    while (isIgnored(lookahead)) {
      lookaheadPosition = positionAfter(text, lookaheadPosition);
      lookahead = categoryAt(text, lookaheadPosition);
    }

    if (isAHLetter(left) && isAHLetter(right)) continue;
    if (
      isAHLetter(left) &&
      isAHLetter(lookahead) &&
      (right === WordBreakCategory.MidLetter || isMidNumLetOrQuote(right))
    ) {
      continue;
    }
    if (
      isAHLetter(lookbehind) &&
      isAHLetter(right) &&
      (left === WordBreakCategory.MidLetter || isMidNumLetOrQuote(left))
    ) {
      continue;
    }
    if (left === WordBreakCategory.HebrewLetter && right === WordBreakCategory.SingleQuote) {
      continue;
    }
    if (
      left === WordBreakCategory.HebrewLetter &&
      right === WordBreakCategory.DoubleQuote &&
      lookahead === WordBreakCategory.HebrewLetter
    ) {
      continue;
    }
    if (
      lookbehind === WordBreakCategory.HebrewLetter &&
      left === WordBreakCategory.DoubleQuote &&
      right === WordBreakCategory.HebrewLetter
    ) {
      continue;
    }
    if (left === WordBreakCategory.Numeric && right === WordBreakCategory.Numeric) continue;
    if (isAHLetter(left) && right === WordBreakCategory.Numeric) continue;
    if (left === WordBreakCategory.Numeric && isAHLetter(right)) continue;
    if (
      lookbehind === WordBreakCategory.Numeric &&
      right === WordBreakCategory.Numeric &&
      (left === WordBreakCategory.MidNum || isMidNumLetOrQuote(left))
    ) {
      continue;
    }
    if (
      left === WordBreakCategory.Numeric &&
      lookahead === WordBreakCategory.Numeric &&
      (right === WordBreakCategory.MidNum || isMidNumLetOrQuote(right))
    ) {
      continue;
    }
    if (left === WordBreakCategory.Katakana && right === WordBreakCategory.Katakana) continue;
    if (
      (isAHLetter(left) ||
        left === WordBreakCategory.Numeric ||
        left === WordBreakCategory.Katakana ||
        left === WordBreakCategory.ExtendNumLet) &&
      right === WordBreakCategory.ExtendNumLet
    ) {
      continue;
    }
    if (
      (isAHLetter(right) ||
        right === WordBreakCategory.Numeric ||
        right === WordBreakCategory.Katakana) &&
      left === WordBreakCategory.ExtendNumLet
    ) {
      continue;
    }

    if (right === WordBreakCategory.RegionalIndicator) {
      const shouldJoinPair =
        left === WordBreakCategory.RegionalIndicator && consecutiveRegionalIndicators % 2 === 1;
      consecutiveRegionalIndicators =
        left === WordBreakCategory.RegionalIndicator ? consecutiveRegionalIndicators + 1 : 1;
      if (shouldJoinPair) continue;
    } else {
      consecutiveRegionalIndicators = 0;
    }
    yield rightPosition;
  } while (rightPosition < text.length);
}

function findPictographicAfterJoiner(
  text: string,
  rightPosition: number,
  right: WordBreakCategory,
  lookaheadPosition: number,
): number | undefined {
  let category = right;
  let position = rightPosition;
  let nextPosition = lookaheadPosition;
  while (category === WordBreakCategory.Extend || category === WordBreakCategory.Format) {
    position = nextPosition;
    category = categoryAt(text, position);
    nextPosition = positionAfter(text, position);
  }
  if (
    category === WordBreakCategory.ZeroWidthJoiner &&
    isInRanges(text.codePointAt(nextPosition) as number, extendedPictographicRanges)
  ) {
    return nextPosition;
  }
  return undefined;
}

function categoryAt(text: string, position: number): WordBreakCategory {
  if (position < 0) return WordBreakCategory.StartOfText;
  if (position >= text.length) return WordBreakCategory.EndOfText;
  const codePoint = text.codePointAt(position) as number;
  let low = 0;
  let high = categorizedRanges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = categorizedRanges[middle] as CategorizedRange;
    if (codePoint < range.begin) high = middle - 1;
    else if (codePoint >= range.end) low = middle + 1;
    else return range.category;
  }
  return WordBreakCategory.Other;
}

function positionAfter(text: string, position: number): number {
  if (position >= text.length) return text.length;
  return position + ((text.codePointAt(position) as number) > 0xffff ? 2 : 1);
}

function containsAlphanumeric(text: string): boolean {
  for (const character of text) {
    if (isAlphanumeric(character.codePointAt(0) as number)) return true;
  }
  return false;
}

function isInRanges(codePoint: number, ranges: readonly UnicodeRange[]): boolean {
  if (!Number.isSafeInteger(codePoint)) return false;
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = ranges[middle] as UnicodeRange;
    if (codePoint < range.begin) high = middle - 1;
    else if (codePoint >= range.end) low = middle + 1;
    else return true;
  }
  return false;
}

function categorize(
  ranges: readonly UnicodeRange[],
  category: WordBreakCategory,
): CategorizedRange[] {
  return ranges.map(({ begin, end }) => ({ begin, category, end }));
}

function isNewline(category: WordBreakCategory): boolean {
  return (
    category === WordBreakCategory.Newline ||
    category === WordBreakCategory.CarriageReturn ||
    category === WordBreakCategory.LineFeed
  );
}

function isIgnored(category: WordBreakCategory): boolean {
  return (
    category === WordBreakCategory.Format ||
    category === WordBreakCategory.Extend ||
    category === WordBreakCategory.ZeroWidthJoiner
  );
}

function isAHLetter(category: WordBreakCategory): boolean {
  return category === WordBreakCategory.ALetter || category === WordBreakCategory.HebrewLetter;
}

function isMidNumLetOrQuote(category: WordBreakCategory): boolean {
  return category === WordBreakCategory.MidNumLet || category === WordBreakCategory.SingleQuote;
}
