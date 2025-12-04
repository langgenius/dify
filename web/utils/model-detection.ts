import type { ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'

export const isNanoBanana = (...fields: Array<string | undefined>): boolean => {
  const normalize = (s?: string) => (s || '').toLowerCase().replaceAll(/\s|_|-/g, '')
  const blob = normalize(fields.filter(Boolean).join(' '))
  return blob.includes('nanobanana')
}

export const MEDIA_RESOLUTION_RULE: ModelParameterRule = {
  name: 'media_resolution',
  type: 'int',
  required: false,
  default: 0, // 0=UNSPECIFIED, 1=LOW, 2=MEDIUM, 3=HIGH
  label: {
    en_US: 'Media resolution',
    zh_Hans: '媒体分辨率',
  },
  min: 0,
  max: 3,
  // Provide labeled options for generic rendering
  options: [
    { value: 0, name: 'Unspecified' },
    { value: 1, name: 'Low' },
    { value: 2, name: 'Medium' },
    { value: 3, name: 'High' },
  ],
}
