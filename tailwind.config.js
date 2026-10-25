/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Vazirmatn', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        studio: {
          950: '#090b10',
          900: '#0f1219',
          850: '#141824',
          800: '#1a2030',
          700: '#252d42',
          600: '#35405c',
        },
      },
    },
  },
  plugins: [],
};
