/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#fbf9ec',
          100: '#f5eedc',
          200: '#faefb9',
          300: '#ede3c6',
        },
        gold: {
          400: '#f6cb5b',
          500: '#deb958',
          600: '#cfa63b',
          700: '#cc9e2c',
        },
        brown: {
          400: '#8c5c37',
          500: '#72482d',
        },
        mint: {
          400: '#a2dcbb',
          500: '#6fb98f',
        },
      },
      fontFamily: {
        sans: ['Microsoft YaHei UI', 'PingFang SC', 'sans-serif'],
      },
      animation: {
        'bounce-in': 'bounceIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'pop': 'pop 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
        'wiggle': 'wiggle 0.5s ease-in-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'typing': 'typing 1.5s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'pulse-scale': 'pulseScale 2s ease-in-out infinite',
        'waveform': 'waveform 0.8s ease-in-out infinite',
        'badge-pop': 'badgePop 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      keyframes: {
        bounceIn: {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '50%': { transform: 'scale(1.1)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pop: {
          '0%': { transform: 'scale(0.95)' },
          '50%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        typing: {
          '0%': { opacity: '0.3' },
          '50%': { opacity: '1' },
          '100%': { opacity: '0.3' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        pulseScale: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.02)' },
        },
        waveform: {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
        floatSlow: {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-12px) rotate(5deg)' },
        },
        floatReverse: {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(10px) rotate(-5deg)' },
        },
        badgePop: {
          '0%': { transform: 'scale(0)' },
          '70%': { transform: 'scale(1.2)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      boxShadow: {
        'button': '0px 4px 0px 0px',
        'card': '0px 4px 4px 0px rgba(114, 72, 45, 0.25)',
        'input': '0px 4px 10px 0px rgba(204, 158, 44, 0.53)',
        'inset-card': 'inset 0px 4px 4px 0px rgba(114, 72, 45, 0.25)',
      },
    },
  },
  plugins: [],
}
