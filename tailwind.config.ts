import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        serif: ["var(--font-crimson)", "Georgia", "serif"],
        display: ["var(--font-cinzel)", "Georgia", "serif"],
      },
      colors: {
        // Premium fantasy VTT palette
        parchment: {
          50: "#fbf6e9",
          100: "#f3e9c8",
          200: "#e6d29a",
          300: "#d4b66a",
          400: "#b89345",
          500: "#8d6e2c",
        },
        brass: {
          300: "#d8b878",
          400: "#c39a4e",
          500: "#a47830",
          600: "#7d5a22",
          700: "#5a4017",
        },
        ink: {
          50: "#e8e6dd",
          100: "#bbb8a8",
          200: "#7a7666",
          300: "#3d3a31",
          400: "#272620",
          500: "#191814",
          600: "#0e0d0a",
        },
        blood: {
          500: "#8a1a1a",
          600: "#6b1414",
        },
        arcane: {
          400: "#9c7bd6",
          500: "#6b4ba6",
          600: "#4a3279",
        },
      },
      backgroundImage: {
        "parchment-grain":
          "radial-gradient(circle at 30% 20%, rgba(212,182,106,0.08), transparent 50%), radial-gradient(circle at 70% 80%, rgba(138,26,26,0.06), transparent 60%)",
      },
      boxShadow: {
        brass: "0 0 0 1px rgba(195,154,78,0.4), 0 8px 24px -8px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [typography],
};

export default config;
