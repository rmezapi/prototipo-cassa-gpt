// frontend/tailwind.config.ts
import type { Config } from 'tailwindcss'

export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}", // Include all JS/TS/JSX/TSX files in the app folder
    // Add other paths if necessary (e.g., "./components/**/*.{js,ts,jsx,tsx}")
  ],
  darkMode: 'class', // Enable class-based dark mode
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#121212',
          card: '#1e1e1e',
          border: '#2e2e2e',
          text: '#e0e0e0',
          muted: '#a0a0a0',
          accent: '#3b82f6' // Keep blue as accent color
        }
      }
    },
  },
  plugins: [],
} satisfies Config
