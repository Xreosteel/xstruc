import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@xstruc/engine"]   // the workspace engine ships as plain ES modules
};

export default config;
