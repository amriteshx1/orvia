import Redis from "ioredis";

const publishers = new Map<string, Redis>();

export function executionChannel(executionId: string): string {
  return `orvia:execution:${executionId}`;
}

function publisher(redisUrl: string): Redis {
  let connection = publishers.get(redisUrl);
  if (!connection) {
    connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    publishers.set(redisUrl, connection);
  }
  return connection;
}

export async function publishExecution(redisUrl: string, executionId: string): Promise<void> {
  try {
    await publisher(redisUrl).publish(executionChannel(executionId), executionId);
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.warn(`execution publish ${name}`);
  }
}

export function subscribeExecution(
  redisUrl: string,
  executionId: string,
  onMessage: () => void,
): () => Promise<void> {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const channel = executionChannel(executionId);
  void connection.subscribe(channel);
  connection.on("message", (incoming) => {
    if (incoming === channel) onMessage();
  });
  return async () => {
    connection.disconnect();
  };
}
