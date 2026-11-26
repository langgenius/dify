import { createCn } from 'cn/config'

// Every typography `@utility` in ./styles/utilities.css, grouped by whether it sets `text-transform`.
const typography = [
  'system-kbd',
  'system-2xs-regular',
  'system-2xs-medium',
  'system-xs-regular',
  'system-xs-medium',
  'system-xs-semibold',
  'system-sm-regular',
  'system-sm-medium',
  'system-sm-semibold',
  'system-md-regular',
  'system-md-medium',
  'system-md-semibold',
  'system-xl-medium',
  'system-xl-semibold',
  'code-xs-regular',
  'code-sm-regular',
  'code-sm-semibold',
  'body-xs-regular',
  'body-xs-medium',
  'body-sm-regular',
  'body-sm-medium',
  'body-md-regular',
  'body-md-medium',
  'body-lg-regular',
  'body-2xl-regular',
  'title-xs-semi-bold',
  'title-sm-semi-bold',
  'title-md-semi-bold',
  'title-lg-bold',
  'title-xl-semi-bold',
  'title-2xl-semi-bold',
  'title-3xl-semi-bold',
  'title-3xl-bold',
  'title-4xl-semi-bold',
  'title-5xl-semi-bold',
  'title-5xl-bold',
]

const uppercaseTypography = [
  'system-2xs-regular-uppercase',
  'system-2xs-medium-uppercase',
  'system-2xs-semibold-uppercase',
  'system-xs-regular-uppercase',
  'system-xs-medium-uppercase',
  'system-xs-semibold-uppercase',
  'system-sm-medium-uppercase',
  'system-sm-semibold-uppercase',
  'system-md-semibold-uppercase',
]

export const cn = createCn<'typography' | 'typography-uppercase'>({
  extend: {
    classGroups: {
      typography,
      'typography-uppercase': uppercaseTypography,
    },
    conflictingClassGroups: {
      typography: ['typography-uppercase', 'font-size', 'font-weight', 'leading'],
      'typography-uppercase': [
        'typography',
        'font-size',
        'font-weight',
        'leading',
        'text-transform',
      ],
    },
  },
})
