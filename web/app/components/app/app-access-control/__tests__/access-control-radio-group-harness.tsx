import type { ReactNode } from 'react'
import type { AccessMode } from '@/models/access-control'
import { RadioGroup } from '@langgenius/dify-ui/radio-group'
import { useAccessControlStore } from '../store'

export function AccessControlRadioGroupHarness({ children }: {
  children: ReactNode
}) {
  const currentMenu = useAccessControlStore(state => state.currentMenu)
  const setCurrentMenu = useAccessControlStore(state => state.setCurrentMenu)

  return (
    <RadioGroup<AccessMode> value={currentMenu} onValueChange={setCurrentMenu}>
      {children}
    </RadioGroup>
  )
}
