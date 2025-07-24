import React from 'react'
import InputField from './input-field'

const TestPage: React.FC = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-md bg-white p-4 shadow-md">
        <h1 className="mb-4 text-xl font-bold">Test Input Field</h1>
        <InputField />
      </div>
    </div>
  )
}

export default TestPage
