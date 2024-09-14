'use client'

import { useEffect, useRef, useState } from 'react'
import { RiAddLine, RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { MagicBox } from '@/app/components/base/icons/src/vender/solid/mediaAndDevices'
import { FileZip } from '@/app/components/base/icons/src/vender/solid/files'
import { Github } from '@/app/components/base/icons/src/vender/solid/general'

const InstallPluginDropdown = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node))
        setIsMenuOpen(false)
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  return (
    <div className="relative" ref={menuRef}>
      <Button
        className='w-full h-full p-2 text-components-button-secondary-text'
        onClick={() => setIsMenuOpen(!isMenuOpen)}
      >
        <RiAddLine className='w-4 h-4' />
        <span className='pl-1'>Install plugin</span>
        <RiArrowDownSLine className='w-4 h-4 ml-1' />
      </Button>
      {isMenuOpen && (
        <div className='flex flex-col items-start absolute z-1000 top-full left-0 mt-1 p-1 pb-2
        w-[200px] bg-components-panel-bg-blur border border-components-panel-border rounded-xl
        shadows-shadow-lg'>
          <span className='flex pt-1 pb-0.5 pl-2 pr-3 items-start self-stretch text-text-tertiary
          system-xs-medium-uppercase'>
            Install Form
          </span>
          {[
            { icon: MagicBox, text: 'Marketplace', action: 'marketplace' },
            { icon: Github, text: 'GitHub', action: 'github' },
            { icon: FileZip, text: 'Local Package File', action: 'local' },
          ].map(({ icon: Icon, text, action }) => (
            <div
              key={action}
              className='flex items-center w-full px-2 py-1.5 gap-1 rounded-lg hover:bg-state-base-hover cursor-pointer'
              onClick={() => {
                console.log(action)
                setIsMenuOpen(false)
              }}
            >
              <Icon className="w-4 h-4 text-text-tertiary" />
              <span className='px-1 text-text-secondary system-md-regular'>{text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default InstallPluginDropdown
