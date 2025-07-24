import React from 'react'
import Input from '@/app/components/base/input'
import Button from '@/app/components/base/button'
import Tooltip from '@/app/components/base/tooltip'
import { RiSendPlaneLine } from '@remixicon/react'

const InputField: React.FC = () => {
  return (
    <div className="flex flex-col space-y-4">
      {/* Input Field */}
      <div className="flex items-center space-x-2">
        <Input
          className="flex-1 rounded-md border border-components-input-border-active bg-components-input-bg-normal px-4 py-2 text-text-primary"
          placeholder="Enter your text here"
        />
        <Tooltip popupContent="Submit">
          <Button className="bg-components-button-primary-bg text-components-button-primary-text hover:bg-components-button-primary-bg-hover">
            <RiSendPlaneLine className="h-5 w-5" />
          </Button>
        </Tooltip>
      </div>

      {/* Additional Info */}
      <p className="text-sm text-components-input-text-placeholder">
        Please provide the required information.
      </p>
    </div>
  )
}

export default InputField
