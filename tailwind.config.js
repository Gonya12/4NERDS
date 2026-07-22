/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111827",
        paper: "#f7f8fb",
        mint: "#10b981",
        coral: "#f97316",
        brand: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c"
        },
        night: {
          950: "#070b14",
          900: "#0b1220",
          850: "#101827",
          800: "#172033"
        }
      },
      boxShadow: {
        soft: "0 12px 36px rgba(15, 23, 42, 0.08)",
        card: "0 18px 46px -24px rgba(15, 23, 42, 0.28)",
        elevated: "0 24px 64px -28px rgba(7, 11, 20, 0.5)",
        glow: "0 14px 38px -16px rgba(249, 115, 22, 0.58)"
      },
      borderRadius: {
        card: "1rem",
        panel: "1.25rem"
      },
      transitionDuration: {
        180: "180ms",
        240: "240ms"
      },
      transitionTimingFunction: {
        premium: "cubic-bezier(0.22, 1, 0.36, 1)"
      },
      keyframes: {
        "page-enter": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        "card-enter": {
          "0%": { opacity: "0", transform: "translateY(10px) scale(0.99)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        "modal-enter": {
          "0%": { opacity: "0", transform: "translateY(14px) scale(0.985)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" }
        },
        shimmer: {
          "0%": { transform: "translateX(-110%)" },
          "100%": { transform: "translateX(110%)" }
        },
        "success-pop": {
          "0%": { transform: "scale(0.82)", opacity: "0" },
          "65%": { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" }
        }
      },
      animation: {
        "page-enter": "page-enter 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "card-enter": "card-enter 260ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "modal-enter": "modal-enter 220ms cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.65s ease-in-out infinite",
        "success-pop": "success-pop 300ms cubic-bezier(0.22, 1, 0.36, 1) both"
      }
    },
  },
  plugins: [],
};
