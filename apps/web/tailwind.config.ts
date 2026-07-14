import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#0d1117',
        panel: '#161b22',
        border: '#30363d',
        accent: '#d4a017',
      },
    },
  },
  plugins: [],
};
export default config;
