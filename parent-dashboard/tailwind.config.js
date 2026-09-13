/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        space: {
          900: '#07090C',
          800: '#0B0E13',
          700: '#11151D',
          600: '#1A2029',
        },
        neon: {
          DEFAULT: '#00FFC8',
          dim: '#00C9A0',
        },
        hazard: '#FF2E63',
        volt: '#FFD60A',
        accent: {
          DEFAULT: '#00FFC8',
          soft: '#7CFFF0',
          cyan: '#4FC3F7',
          green: '#34D399',
          amber: '#FBBF24',
          red: '#FF2E63',
        },
      },
      boxShadow: {
        brutal: '4px 4px 0 0 #000',
        'brutal-lg': '8px 8px 0 0 #000',
        'brutal-neon': '4px 4px 0 0 #00FFC8',
        'brutal-red': '4px 4px 0 0 #FF2E63',
        float: '0 20px 60px -15px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255,255,255,0.05) inset',
        glow: '0 0 30px -8px rgba(0, 255, 200, 0.45)',
        'glow-green': '0 0 30px -8px rgba(52, 211, 153, 0.6)',
      },
      animation: {
        'pulse-slow': 'pulse 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        floaty: 'floaty 6s ease-in-out infinite',
        'fade-up': 'fadeUp .45s ease both',
        'blink': 'blink 1.1s steps(2, start) infinite',
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
        blink: {
          '50%': { opacity: '0.25' },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
