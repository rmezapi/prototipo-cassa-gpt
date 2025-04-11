// frontend/tailwind.config.ts
import type { Config } from 'tailwindcss'

export default {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}", // Include all JS/TS/JSX/TSX files in the app folder
    // Add other paths if necessary (e.g., "./components/**/*.{js,ts,jsx,tsx}")
  ],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config
