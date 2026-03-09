/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tile: {
          full: '#A7C7E7',
          cut: '#E89B7B',
          grout: '#6B7280',
          room: '#1F2937',
        },
      },
    },
  },
  plugins: [],
};
