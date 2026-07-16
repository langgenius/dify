import { TONE_LIST } from '@/config'

export const getSupportedPresetConfig = (toneId: number, supportedParameterNames?: string[]) => {
  const tone = TONE_LIST.find((tone) => tone.id === toneId)
  if (!tone?.config) return {}

  if (!supportedParameterNames) return { ...tone.config }

  const supportedParameterNameSet = new Set(supportedParameterNames)

  return Object.entries(tone.config).reduce<Record<string, number>>((acc, [key, value]) => {
    if (supportedParameterNameSet.has(key)) acc[key] = value

    return acc
  }, {})
}
