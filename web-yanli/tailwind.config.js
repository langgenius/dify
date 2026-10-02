/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 水墨系主色调
        ink: {
          black: '#1a1a1a',
          grey: '#4a4a4a',
          light: '#8a8a8a',
        },
        paper: {
          white: '#fafaf8',
          grey: '#f5f5f3',
        },
        mist: {
          grey: '#e8e8e6',
          light: '#f0f0ee',
        },
        // 文人雅色点缀
        bamboo: {
          green: '#7c9885',
          light: '#a8c5b0',
          dark: '#5a7363',
        },
        pine: {
          green: '#5a7363',
          dark: '#3d4f44',
        },
        clay: {
          red: '#b7817a',
          light: '#d4a59f',
        },
        sky: {
          blue: '#a8c5d1',
          light: '#c8dce5',
        },
      },
      fontFamily: {
        serif: ['Source Han Serif CN', 'Noto Serif SC', 'serif'],
        sans: ['PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        en: ['Inter', 'SF Pro Display', 'sans-serif'],
      },
      spacing: {
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      borderRadius: {
        'yanli': '8px',
      },
      boxShadow: {
        'yanli': '0 2px 8px rgba(26, 26, 26, 0.08)',
        'yanli-lg': '0 4px 16px rgba(26, 26, 26, 0.12)',
        'ink': '0 0 0 4px rgba(124, 152, 133, 0.1)',
      },
      animation: {
        'ink-spread': 'ink-spread 0.3s ease-out',
      },
      keyframes: {
        'ink-spread': {
          '0%': { boxShadow: '0 0 0 0 rgba(124, 152, 133, 0.3)' },
          '100%': { boxShadow: '0 0 0 8px rgba(124, 152, 133, 0)' },
        },
      },
    },
  },
  plugins: [],
}
