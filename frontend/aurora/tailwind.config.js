/**
 * AURORA design tokens.
 *
 * Deep-navy polar operations interface built on the three brand primaries
 * #071521 (abyss), #0B2233 (deck) and #12354A (panel), extended into a
 * monotonic surface scale so every existing `graphite.*` utility keeps its
 * relative lightness. Flat surfaces, hairline borders, off-white type and a
 * single restrained ice-blue accent. There are no neon hues and no glow
 * shadows anywhere in this file - every value is a plain colour or shadow.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand primaries, named for direct use
        aurora: {
          abyss: '#071521',
          deck: '#0B2233',
          panel: '#12354A',
        },

        // Core surfaces - deep navy, monotonically lighter with each step
        graphite: {
          950: '#040D15',
          900: '#071521',
          850: '#0A1C2B',
          800: '#0B2233',
          750: '#0F2B41',
          700: '#12354A',
          600: '#133850',
          500: '#1E5274',
        },

        // Off-white typography scale (this is the "white" every component uses)
        // Redefined so `text-white` renders as paper rather than pure #fff.
        white: '#E9ECEF',

        // Secondary / tertiary text
        mist: '#98A1A9',
        steel: {
          DEFAULT: '#6E7881',
          dark: '#4E575F',
        },

        // The single restrained accent
        ice: {
          DEFAULT: '#7FB4D4',
          bright: '#A8CFE6',
          dim: '#51809B',
          faint: '#243743',
        },

        // Alias kept so existing `cyan` / `azure` references stay on-accent
        cyan: '#7FB4D4',
        azure: '#7FB4D4',
        mint: '#7FB4D4',

        // Muted semantic tones
        safe: '#74A17C',
        warn: '#C39A4A',
        danger: '#C1655C',

        // Legacy surface aliases (older components) mapped onto the navy scale
        abyssal: '#071521',
        'abyssal-deck': '#0A1C2B',
        'abyssal-card': '#0B2233',
        'abyssal-card-hover': '#0F2B41',
        navy: '#071521',
        'navy-deep': '#040D15',
        'navy-mid': '#0B2233',
        'navy-light': '#0F2B41',
        ocean: '#12354A',
        'ocean-deep': '#0B2233',
        slate: '#0F2B41',
        amethyst: '#8896A3',
        'ice-pale': '#C6D6E0',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"IBM Plex Sans"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0, 0, 0, 0.35)',
        overlay: '0 8px 24px rgba(0, 0, 0, 0.45)',
        card: '0 1px 2px rgba(0, 0, 0, 0.3)',
        glow: '0 1px 2px rgba(0, 0, 0, 0.3)',
        'glow-azure': '0 1px 2px rgba(0, 0, 0, 0.3)',
        '2xl': '0 8px 24px rgba(0, 0, 0, 0.4)',
      },
      backgroundImage: {
        'abyssal-gradient': 'linear-gradient(180deg, #071521 0%, #040D15 100%)',
        'hero-gradient':
          'radial-gradient(120% 90% at 12% 0%, rgba(18, 53, 74, 0.85) 0%, rgba(7, 21, 33, 0) 60%), linear-gradient(180deg, #071521 0%, #040D15 100%)',
        // The AURORA motif: polar navigation grid + faint aurora light band
        'polar-grid':
          'linear-gradient(rgba(127, 180, 212, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(127, 180, 212, 0.035) 1px, transparent 1px)',
        'nav-grid':
          'linear-gradient(rgba(127, 180, 212, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(127, 180, 212, 0.06) 1px, transparent 1px)',
        'aurora-veil':
          'linear-gradient(100deg, rgba(127, 180, 212, 0) 8%, rgba(127, 180, 212, 0.10) 34%, rgba(81, 128, 155, 0.16) 52%, rgba(127, 180, 212, 0) 78%)',
        'aurora-ramp':
          'linear-gradient(90deg, #040D15 0%, #071521 28%, #0B2233 58%, #12354A 82%, #1E5274 100%)',
      },
      borderColor: {
        DEFAULT: '#153A51',
      },
    },
  },
  plugins: [],
}
