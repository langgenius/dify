import type { Label } from '../constant'
import { describe, expect, it } from 'vitest'

describe('tool label type contract', () => {
  it('accepts string labels', () => {
    const label: Label = {
      name: 'agent',
      label: 'Agent',
      icon: 'robot',
    }

    expect(label).toEqual({
      name: 'agent',
      label: 'Agent',
      icon: 'robot',
    })
  })

  it('accepts i18n labels', () => {
    const label: Label = {
      name: 'workflow',
      label: {
        en_US: 'Workflow',
        zh_Hans: '工作流',
      },
    }

    expect(label.label).toEqual({
      en_US: 'Workflow',
      zh_Hans: '工作流',
    })
  })
})
