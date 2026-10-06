/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0B0E14', // deep terminal obsidian
        surface: '#151B26', // slate navy
        line: '#232D3F', // borders & dividers
        hover: '#1E2638', // row hover
        emerald: { DEFAULT: '#10B981' }, // primary accent / positive yield
        amber: { DEFAULT: '#F59E0B' }, // volume spikes / alerts
        action: '#3B82F6', // actions / deep links / buttons
        head: '#F9FAFB',
        muted: '#9CA3AF',
        danger: '#F87171',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
