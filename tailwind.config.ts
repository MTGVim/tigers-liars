import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        felt: '#1b120f',
        ember: '#d97706',
        gold: '#facc15',
      },
      boxShadow: {
        table: '0 20px 40px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};

export default config;
