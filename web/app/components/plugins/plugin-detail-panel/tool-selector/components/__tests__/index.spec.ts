import { describe, expect, it } from 'vitest'
import {
  SchemaModal,
  ToolAuthorizationSection,
  ToolBaseForm,
  ToolCredentialsForm,
  ToolItem,
  ToolSettingsPanel,
  ToolTrigger,
} from '../index'

describe('tool-selector components index', () => {
  it('re-exports the tool selector components', () => {
    expect(SchemaModal).toBeDefined()
    expect(ToolAuthorizationSection).toBeDefined()
    expect(ToolBaseForm).toBeDefined()
    expect(ToolCredentialsForm).toBeDefined()
    expect(ToolItem).toBeDefined()
    expect(ToolSettingsPanel).toBeDefined()
    expect(ToolTrigger).toBeDefined()
  })
})
