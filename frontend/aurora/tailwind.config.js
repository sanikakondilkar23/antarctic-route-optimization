/**
 * AURORA design tokens.
 *
 * Deep-navy polar operations interface: translucent glass surfaces, hairline
 * ice borders, cool off-white type and a single cyan accent. The `graphite`
 * ladder below is the legacy name kept for every existing `graphite-*`
 * utility — it now steps through the navy surface ramp so components that
 * still reference it sit on the same palette as everything else.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Aurora Antarctic Cinematic Palette
        antarctic: {
          navy: '#05182B',
          midnight: '#071D33',
          ocean: '#0A2A4A',
          glacier: '#EAF6FF',
          ice: '#A9DFFF',
          cyan: '#22E5F0',
          sky: '#3AA7FF',
          hazard: '#FF4D5E',
        },

        // Core surfaces - legacy `graphite-*` name, navy surface ramp
        graphite: {
          950: '#031019',
          900: '#05182B',
          850: '#071D33',
          800: '#0A2A4A',
          750: '#0E3050',
          700: '#153C63',
          600: '#1C4974',
          500: '#275B8A',
        },

        // Off-white typography scale (this is the "white" every component uses)
        // Redefined so `text-white` renders as paper rather than pure #fff.
        white: '#E9ECEF',

        // Secondary / tertiary text
        mist: '#9FB3C4',
        steel: {
          DEFAULT: '#7089A0',
          dark: '#4E637A',
        },

        // The single restrained accent
        ice: {
          DEFAULT: '#22E5F0',
          bright: '#A9DFFF',
          dim: '#3AA7FF',
          faint: '#0A2A4A',
        },

        // Alias kept so existing `cyan` / `azure` references stay on-accent
        cyan: '#22E5F0',
        azure: '#3AA7FF',
        mint: '#22E5F0',

        // Muted semantic tones
        safe: '#74A17C',
        warn: '#C39A4A',
        danger: '#FF4D5E',

        // Legacy surface aliases (older components) mapped onto graphite
        abyssal: '#05182B',
        'abyssal-deck': '#071D33',
        'abyssal-card': '#0A2A4A',
        'abyssal-card-hover': '#11355B',
        navy: '#05182B',
        'navy-deep': '#05182B',
        'navy-mid': '#071D33',
        'navy-light': '#0A2A4A',
        ocean: '#0A2A4A',
        'ocean-deep': '#05182B',
        slate: '#172738',
        amethyst: '#8896A3',
        'ice-pale': '#EAF6FF',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', '"Plus Jakarta Sans"', '"IBM Plex Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0, 0, 0, 0.35)',
        overlay: '0 8px 24px rgba(0, 0, 0, 0.45)',
        card: '0 1px 2px rgba(0, 0, 0, 0.3)',
        glow: '0 0 25px rgba(34, 229, 240, 0.25)',
        'glow-cyan': '0 0 30px rgba(34, 229, 240, 0.35)',
        'glow-azure': '0 0 30px rgba(58, 167, 255, 0.35)',
        'glow-hazard': '0 0 30px rgba(255, 77, 94, 0.45)',
        glass: '0 8px 32px 0 rgba(5, 24, 43, 0.5)',
        '2xl': '0 8px 24px rgba(0, 0, 0, 0.4)',
      },
      backgroundImage: {
        'abyssal-gradient': 'linear-gradient(180deg, #05182B 0%, #071D33 50%, #0A2A4A 100%)',
        'hero-gradient': 'linear-gradient(180deg, rgba(5, 24, 43, 0.85) 0%, rgba(5, 24, 43, 0.4) 45%, rgba(7, 29, 51, 0.85) 85%, #05182B 100%)',
        'polar-grid':
          'linear-gradient(rgba(34, 229, 240, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(34, 229, 240, 0.05) 1px, transparent 1px)',
      },
      borderColor: {
        DEFAULT: 'rgba(234, 246, 255, 0.1)',
      },
    },
  },
  plugins: [],
}
