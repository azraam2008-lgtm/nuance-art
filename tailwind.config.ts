import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
      colors: {
        trendyol: '#F27A1A',
        hepsiburada: '#FF6000',
        n11: '#7B2CBF',
        ciceksepeti: '#1E88E5',
      },
    },
  },
  plugins: [],
} satisfies Config;
