const USD_MICRO_PER_HUNDRED_CREDITS = 223_018n

export const formatTokenerCredits = (rawMicroAmount: string, lessThanOne: string) => {
  if (!/^\d+$/.test(rawMicroAmount)) return '—'

  const amount = BigInt(rawMicroAmount)
  const credits = (amount * 100n) / USD_MICRO_PER_HUNDRED_CREDITS
  if (amount > 0n && credits === 0n) return lessThanOne

  return new Intl.NumberFormat().format(credits)
}

export const formatUsdMicro = (rawMicroAmount: string) => {
  if (!/^-?\d+$/.test(rawMicroAmount)) return '—'

  const microAmount = BigInt(rawMicroAmount)
  const isNegative = microAmount < 0n
  const absoluteMicroAmount = isNegative ? -microAmount : microAmount
  const dollars = absoluteMicroAmount / 1_000_000n
  const microDollars = (absoluteMicroAmount % 1_000_000n).toString().padStart(6, '0')
  const fractionalDollars = microDollars.replace(/0+$/, '').padEnd(2, '0')
  return `${isNegative ? '-$' : '$'}${new Intl.NumberFormat().format(dollars)}.${fractionalDollars}`
}

export const formatUtcAllowancePeriod = (startsAt: string, endsAt: string) =>
  `${startsAt.slice(0, 10)} – ${endsAt.slice(0, 10)}`
