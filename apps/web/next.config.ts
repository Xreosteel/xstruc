import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@xstruc/engine", "@xstruc/viewer", "@xstruc/reader"]   // workspace packages ship TypeScript sources
};

export default config;
