/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        // Command Terminal tokens — reference these from every rewritten component.
        ct: {
          bg: 'var(--ct-bg)',
          bg2: 'var(--ct-bg2)',
          panel: 'var(--ct-panel)',
          'panel-hi': 'var(--ct-panel-hi)',
          line: 'var(--ct-line)',
          line2: 'var(--ct-line2)',
          ink: 'var(--ct-ink)',
          ink2: 'var(--ct-ink2)',
          ink3: 'var(--ct-ink3)',
          ink4: 'var(--ct-ink4)',
          accent: 'var(--ct-accent)',
          'accent-soft': 'var(--ct-accent-soft)',
          'accent-border': 'var(--ct-accent-border)',
          gold: 'var(--ct-gold)',
          ok: 'var(--ct-ok)',
          warn: 'var(--ct-warn)',
          crit: 'var(--ct-crit)',
          'ok-soft': 'var(--ct-ok-soft)',
          'ok-border': 'var(--ct-ok-border)',
          'warn-soft': 'var(--ct-warn-soft)',
          'warn-border': 'var(--ct-warn-border)',
          'crit-soft': 'var(--ct-crit-soft)',
          'crit-border': 'var(--ct-crit-border)',
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'JetBrains Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
      letterSpacing: {
        eyebrow: '0.22em',
        wider2: '0.18em',
      },
    },
  },
  plugins: [],
}
