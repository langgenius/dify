import * as React from 'react'

function usePickerNumbers(locale: Intl.LocalesArgument = 'en-US') {
  return React.useMemo(() => {
    const integer = new Intl.NumberFormat(locale, { useGrouping: false })
    const minute = new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: 2 })
    const digits = new Map(
      Array.from({ length: 10 }, (_, digit) => [integer.format(digit), String(digit)]),
    )
    return {
      numberingSystem: integer.resolvedOptions().numberingSystem,
      formatInteger: integer.format,
      formatMinute: minute.format,
      normalizeDigits: (text: string) =>
        Array.from(text, (char) => digits.get(char) ?? char).join(''),
    }
  }, [locale])
}

export { usePickerNumbers }
