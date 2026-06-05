// SPDX-License-Identifier: AGPL-3.0-only
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        splyntra: {
          50: "#f0f4ff",
          100: "#dbe4ff",
          500: "#4c6ef5",
          600: "#3b5bdb",
          700: "#364fc7",
          900: "#1c2541",
        },
        risk: {
          low: "#51cf66",
          medium: "#fcc419",
          high: "#ff6b6b",
          critical: "#c92a2a",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
