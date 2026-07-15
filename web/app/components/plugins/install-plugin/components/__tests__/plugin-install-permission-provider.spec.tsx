import { render, screen } from '@testing-library/react'
import usePluginInstallPermission from '../../hooks/use-plugin-install-permission'
import {
  PluginInstallPermissionProvider,
  PluginInstallPermissionProviderGuard,
} from '../plugin-install-permission-provider'

const PermissionProbe = () => {
  const { canInstallPlugin, canUpdatePlugin, currentDifyVersion } = usePluginInstallPermission()

  return (
    <div>
      <span>
        install:
        {String(canInstallPlugin)}
      </span>
      <span>
        update:
        {String(canUpdatePlugin)}
      </span>
      <span>
        version:
        {currentDifyVersion}
      </span>
    </div>
  )
}

describe('PluginInstallPermissionProvider', () => {
  // Rendering provides plugin permission state to hook consumers.
  describe('Rendering', () => {
    it('should provide explicit install, update, and version values', () => {
      render(
        <PluginInstallPermissionProvider
          canInstallPlugin
          canUpdatePlugin={false}
          currentDifyVersion="1.2.3"
        >
          <PermissionProbe />
        </PluginInstallPermissionProvider>,
      )

      expect(screen.getByText('install:true')).toBeInTheDocument()
      expect(screen.getByText('update:false')).toBeInTheDocument()
      expect(screen.getByText('version:1.2.3')).toBeInTheDocument()
    })

    it('should update provided values after rerender', () => {
      const { rerender } = render(
        <PluginInstallPermissionProvider canInstallPlugin currentDifyVersion="1.0.0">
          <PermissionProbe />
        </PluginInstallPermissionProvider>,
      )

      rerender(
        <PluginInstallPermissionProvider canInstallPlugin={false} currentDifyVersion="2.0.0">
          <PermissionProbe />
        </PluginInstallPermissionProvider>,
      )

      expect(screen.getByText('install:false')).toBeInTheDocument()
      expect(screen.getByText('update:false')).toBeInTheDocument()
      expect(screen.getByText('version:2.0.0')).toBeInTheDocument()
    })
  })
})

describe('PluginInstallPermissionProviderGuard', () => {
  // Guard avoids replacing an existing provider higher in the tree.
  describe('Rendering', () => {
    it('should keep existing provider values when nested under a provider', () => {
      render(
        <PluginInstallPermissionProvider canInstallPlugin={false} currentDifyVersion="outer">
          <PluginInstallPermissionProviderGuard canInstallPlugin currentDifyVersion="inner">
            <PermissionProbe />
          </PluginInstallPermissionProviderGuard>
        </PluginInstallPermissionProvider>,
      )

      expect(screen.getByText('install:false')).toBeInTheDocument()
      expect(screen.getByText('version:outer')).toBeInTheDocument()
    })
  })
})
