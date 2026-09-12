/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        space: {
          900: '#070B1A',
          800: '#0B1020',
          700: '#111A33',
          600: '#1A2547',
        },
        accent: {
          DEFAULT: '#7C6CF6',
          soft: '#9D8FFF',
          cyan: '#4FC3F7',
          green: '#34D399',
          amber: '#FBBF24',
          red: '#F87171',
        },
      },
      boxShadow: {
        float: '0 20px 60px -15px rgba(8, 12, 32, 0.9), 0 0 0 1px rgba(255,255,255,0.06) inset',
        glow: '0 0 40px -10px rgba(124, 108, 246, 0.55)',
        'glow-green': '0 0 30px -8px rgba(52, 211, 153, 0.6)',
      },
      animation: {
        'pulse-slow': 'pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        floaty: 'floaty 6s ease-in-out infinite',
        'fade-up': 'fadeUp .45s ease both',
      },
      keyframes: {
        floaty: {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
