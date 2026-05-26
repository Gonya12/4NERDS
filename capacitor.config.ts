import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.fournerds.eventtracker",
  appName: "4 Nerds",
  webDir: "dist",
  server: {
    androidScheme: "https"
  }
};

export default config;
