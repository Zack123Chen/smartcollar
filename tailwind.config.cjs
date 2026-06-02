/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["'Share Tech Mono'", "'Courier New'", "monospace"],
        display: ["Orbitron", "sans-serif"]
      }
    }
  },
  plugins: [require("@tailwindcss/forms")]
};
