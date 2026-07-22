export type RetrievalQueryLanguage = "cjk" | "latin" | "mixed-cjk-latin" | "other";

export function normalizeMixedLanguageFtsText(input: string): string {
  const tokens: string[] = [];
  let current = "";

  for (const char of input.normalize("NFKC").toLowerCase()) {
    if (isCjkSearchChar(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }

      tokens.push(char);
      continue;
    }

    if (isSearchTokenChar(char)) {
      current += char;
      continue;
    }

    if (current) {
      tokens.push(current);
      current = "";
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens.join(" ");
}

export function detectRetrievalQueryLanguage(query: string): RetrievalQueryLanguage {
  let hasCjk = false;
  let hasLatin = false;

  for (const char of query.normalize("NFKC")) {
    if (isCjkSearchChar(char)) {
      hasCjk = true;
      continue;
    }

    if (/[A-Za-z0-9]/.test(char)) {
      hasLatin = true;
    }
  }

  if (hasCjk && hasLatin) {
    return "mixed-cjk-latin";
  }

  if (hasCjk) {
    return "cjk";
  }

  if (hasLatin) {
    return "latin";
  }

  return "other";
}

function isCjkSearchChar(char: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
}

function isSearchTokenChar(char: string): boolean {
  return /[\p{Letter}\p{Number}]/u.test(char);
}
