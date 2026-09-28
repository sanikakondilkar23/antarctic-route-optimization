/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Deep Abyssal Obsidian & Slate base (replaces generic navy)
        abyssal: '#080C14',
        'abyssal-deck': '#0D1424',
        'abyssal-card': '#131E34',
        'abyssal-card-hover': '#182744',
        'abyssal-border': 'rgba(255, 255, 255, 0.08)',

        // Glacial Aurora & Polar Accents
        mint: '#00F2C3',
        'mint-glow': '#10E7B3',
        azure: '#38BDF8',
        'azure-deep': '#2563EB',
        amethyst: '#818CF8',
        ice: '#E0F7FF',
        'ice-pale': '#A9E8FF',

        // Legacy semantic mappings redirected to the new cohesive system
        navy: '#080C14',
        'navy-deep': '#04070D',
        'navy-mid': '#0D1424',
        'navy-light': '#131E34',
        ocean: '#1E3A8A',
        'ocean-deep': '#0F2454',
        cyan: '#00F2C3', // Accent points now use the vibrant Glacial Mint
        'ice-cyan': '#38BDF8',
        slate: '#1E293B',
        mist: '#94A3B8',
        safe: '#00F2C3',
        'safe-dark': '#059669',
        warn: '#F59E0B',
        danger: '#FB7185',
        'danger-deep': '#E11D48',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 4px 20px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06)',
        glow: '0 0 25px rgba(0, 242, 195, 0.18), 0 0 0 1px rgba(0, 242, 195, 0.3)',
        'glow-azure': '0 0 25px rgba(56, 189, 248, 0.18), 0 0 0 1px rgba(56, 189, 248, 0.3)',
      },
      backgroundImage: {
        'abyssal-gradient':
          'radial-gradient(120% 120% at 100% 0%, rgba(0,242,195,0.08) 0%, transparent 50%), radial-gradient(80% 80% at 0% 100%, rgba(37,99,235,0.12) 0%, transparent 50%), linear-gradient(180deg, #04070D 0%, #080C14 50%, #0D1424 100%)',
        'polar-grid':
          'linear-gradient(rgba(0,242,195,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,242,195,0.03) 1px, transparent 1px)',
        'hero-gradient':
          'radial-gradient(120% 100% at 50% 0%, rgba(0,242,195,0.12) 0%, transparent 60%), linear-gradient(180deg, #04070D 0%, #080C14 100%)',
      },
    },
  },
  plugins: [],
}