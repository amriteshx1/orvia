import pg from "pg";
import Redis from "ioredis";

export type HealthReport = {
  ok: boolean;
  postgres: "up" | "down";
  redis: "up" | "down";
  vector: "enabled" | "missing";
};

export async function checkHealth(databaseUrl: string, redisUrl: string): Promise<HealthReport> {
  let postgres: HealthReport["postgres"] = "down";
  let vector: HealthReport["vector"] = "missing";
  let redis: HealthReport["redis"] = "down";

  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("SELECT 1");
    postgres = "up";
    const extension = await client.query(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    if ((extension.rowCount ?? 0) > 0) vector = "enabled";
  } catch {
    postgres = "down";
  } finally {
    await client.end().catch(() => undefined);
  }

  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    lazyConnect: true,
  });
  try {
    await connection.connect();
    if ((await connection.ping()) === "PONG") redis = "up";
  } catch {
    redis = "down";
  } finally {
    connection.disconnect();
  }

  return {
    ok: postgres === "up" && redis === "up" && vector === "enabled",
    postgres,
    redis,
    vector,
  };
}
