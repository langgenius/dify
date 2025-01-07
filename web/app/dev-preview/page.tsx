'use client'

import { useState } from 'react'
import { SwitchPluginVersion } from '../components/workflow/nodes/_base/components/switch-plugin-version'

export default function Page() {
  const [version, setVersion] = useState('0.0.1')
  return <div className="p-20">
    <SwitchPluginVersion
      uniqueIdentifier={'langgenius/openai:12'}
      onSelect={setVersion}
      version={version}
      tooltip='Switch to new version'
    />
  </div>
}
