/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Light "studio" neutrals
        shell: '#F4F3F0',
        panel: '#FFFFFF',
        hairline: '#E6E4DF',
        divider: '#EEEDE9',
        ink: {
          DEFAULT: '#1B1B19', // primary text / active fills
          secondary: '#6C6A64',
          muted: '#9A9892',
        },
        // Dark canvas stage (Konva surface)
        stage: '#1B1A18',
        // Single accent — sliders + focus rings only
        accent: '#3F71B0',
        tile: {
          full: '#8FB3D9',
          cut: '#E0A074',
          grout: '#6B7280',
          room: '#1F2937',
        },
      },
      fontFamily: {
        sans: ['"Hanken Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
