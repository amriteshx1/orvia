import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import type { NextConfig } from "next";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootEnv = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.env");
if (existsSync(rootEnv)) loadEnv({ path: rootEnv });

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@orvia/config", "@orvia/core", "@orvia/db"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "better-auth"],
};

export default nextConfig;
