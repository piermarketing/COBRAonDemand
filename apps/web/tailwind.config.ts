import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#13213a", soft: "#3d4b63", muted: "#66728a" },
        brand: { DEFAULT: "#0e6e6e", dark: "#0a5454", light: "#e3f3f2" },
        line: "#dfe4ec",
        paper: "#f6f8fb",
        warn: { DEFAULT: "#a35a00", light: "#fdf2e2" },
        danger: { DEFAULT: "#b42318", light: "#fdecea" },
        ok: { DEFAULT: "#1d7a46", light: "#e6f4ec" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"] },
    },
  },
  plugins: [],
} satisfies Config;
