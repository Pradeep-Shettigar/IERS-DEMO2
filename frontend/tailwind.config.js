/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111310",
        panel: "#1A1D18",
        panelLight: "#22261F",
        line: "#33372E",
        signal: "#FFB020",
        live: "#7FB069",
        sold: "#E85D4C",
        muted: "#8A8F80",
        paper: "#EDEBE2",
      },
      fontFamily: {
        display: ["var(--font-space)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
        body: ["var(--font-inter)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
