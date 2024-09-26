/** @type {import('tailwindcss').Config} */
import commonConfig from './tailwind.common.config';
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './context/**/*.{js,ts,jsx,tsx}',
  ],
  ...commonConfig,
}
