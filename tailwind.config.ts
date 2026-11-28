import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
      colors: {
        // "indigo" sınıfları mağazanın vurgu rengine bağlı (src/lib/theme.ts, Shell bunları değiştirir)
        indigo: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((k) => [k, `rgb(var(--accent-${k}) / <alpha-value>)`])),
        trendyol: '#F27A1A',
        hepsiburada: '#FF6000',
        n11: '#7B2CBF',
        ciceksepeti: '#1E88E5',
      },
    },
  },
  plugins: [],
} satisfies Config;
