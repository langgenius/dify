/** Match locale-specific plural forms to the English family's `other` entry. */
export function getTranslationSourceKey(
  sourceKeys: ReadonlySet<string>,
  key: string,
  language: string,
): string | undefined {
  if (sourceKeys.has(key)) return key

  const match = /^(.*)_(zero|one|two|few|many|other)$/.exec(key)
  if (!match) return undefined
  const [, base, category] = match
  if (!base || !category) return undefined
  const ordinal = base.endsWith('_ordinal')
  const categories: readonly string[] = new Intl.PluralRules(language, {
    type: ordinal ? 'ordinal' : 'cardinal',
  }).resolvedOptions().pluralCategories
  // i18next supports an explicit zero override even when CLDR has no zero category.
  if (!categories.includes(category) && !(category === 'zero' && !ordinal)) return undefined

  const other = `${base}_other`
  return sourceKeys.has(other) ? other : undefined
}
