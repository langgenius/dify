'use client'

import React, { useState } from 'react'
import { useBoolean } from 'ahooks'

type Props = {
  varList: { label: string; value: string }[]
  message_files: string[]
}

const TestVarPanel: React.FC<Props> = ({
  varList,
  message_files,
}) => {
  const [isCollapse, { toggle: toggleCollapse }] = useBoolean(false)
  const [imagePreviewUrl, setImagePreviewUrl] = useState('')

  return (
    <div className='rounded-lg border border-gray-200 bg-white flex flex-col max-h-[400px]'>
      <div
        className={`flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 text-gray-700 cursor-pointer`}
        onClick={toggleCollapse}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
        </svg>
        <div className='grow font-medium'>Variables</div>
        <svg className={`w-4 h-4 transition-transform ${isCollapse ? 'rotate-0' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Outer scrollable container */}
      {!isCollapse && (
        <div className='flex-1 overflow-y-auto' style={{ maxHeight: '400px' }}>
          <div className='p-3 flex flex-col gap-2'>
            {varList.map(({ label, value }, index) => (
              <div key={index} className='flex py-2 text-sm'>
                <div className='shrink-0 w-32 flex text-blue-600'>
                  <span className='shrink-0 opacity-60'>&#123;&#123;</span>
                  <span className='truncate'>{label}</span>
                  <span className='shrink-0 opacity-60'>&#125;&#125;</span>
                </div>

                {/* Value area with scrolling */}
                <div className='flex-1 pl-2.5'>
                  <div
                    className='whitespace-pre-wrap text-gray-600 pr-2'
                    style={{
                      maxHeight: '100px', // Set max height to make it scrollable
                      overflowY: 'auto'   // Enable vertical scrolling
                    }}
                  >
                    {value}
                  </div>
                </div>
              </div>
            ))}

            {/* Display uploaded images */}
            {message_files.length > 0 && (
              <div className='mt-1 flex py-2'>
                <div className='shrink-0 w-32 text-sm text-gray-500'>Uploaded Images</div>
                <div className="flex flex-wrap gap-2">
                  {message_files.map((url, index) => (
                    <div
                      key={index}
                      className="w-16 h-16 rounded-lg bg-no-repeat bg-cover bg-center cursor-pointer"
                      style={{ backgroundImage: `url(${url})` }}
                      onClick={() => setImagePreviewUrl(url)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image preview modal */}
      {imagePreviewUrl && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-4 rounded-lg max-w-3xl max-h-[90vh] overflow-auto">
            <img src={imagePreviewUrl} alt="Preview" className="max-w-full h-auto" />
            <button
              className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={() => setImagePreviewUrl('')}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default React.memo(TestVarPanel)
