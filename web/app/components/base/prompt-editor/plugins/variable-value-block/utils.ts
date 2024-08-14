export function getHashtagRegexString(): string {
  const hashtag = '\\{\\{[a-zA-Z_][a-zA-Z0-9_]{0,29}\\}\\}'

  return hashtag
}
