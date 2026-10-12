import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind theme for Optific+ — mapped from the reference HTML tokens.
 * The shadcn CSS variables live in `src/app/globals.css`.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Brand tokens carried straight from the reference.
        coral: {
          DEFAULT: 'hsl(var(--coral))',
          deep: 'hsl(var(--coral-deep))',
        },
        ink: 'hsl(var(--ink))',
        rail: {
          DEFAULT: 'hsl(var(--rail))',
          active: 'hsl(var(--rail-active))',
        },
        // Dark map canvas (the "reference-led black canvas" direction).
        map: {
          bg: 'hsl(var(--map-bg))',
          fg: 'hsl(var(--map-fg))',
          muted: 'hsl(var(--map-muted))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      boxShadow: {
        soft: '0 8px 32px rgba(26, 36, 56, 0.07)',
        panel: '0 2px 9px rgba(103, 84, 54, 0.05)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
};

export default config;
