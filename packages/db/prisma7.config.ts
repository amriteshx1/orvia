import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const packageDir = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(packageDir, "../../.env") });

export default defineConfig({
  schema: resolve(packageDir, "prisma/schema.prisma"),
  migrations: {
    path: resolve(packageDir, "prisma/migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://orvia:orvia@127.0.0.1:5434/orvia",
  },
});
