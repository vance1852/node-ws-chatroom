import { Logger } from "../utils/Logger.js";

const logger = new Logger("RateLimiter");

export function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 10000;
  const maxMessages = options.maxMessages || 20;
  const buckets = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [clientId, bucket] of buckets) {
      if (now - bucket.windowStart > windowMs * 2) {
        buckets.delete(clientId);
      }
    }
  }, windowMs);

  return (context, next) => {
    const { clientId } = context;
    const now = Date.now();

    if (!buckets.has(clientId)) {
      buckets.set(clientId, { count: 0, windowStart: now });
    }

    const bucket = buckets.get(clientId);

    if (now - bucket.windowStart > windowMs) {
      bucket.count = 0;
      bucket.windowStart = now;
    }

    bucket.count++;

    if (bucket.count > maxMessages) {
      logger.warn(`Rate limit exceeded`, { clientId, count: bucket.count });
      context.reply({
        type: "error",
        content: `Rate limit exceeded. Max ${maxMessages} messages per ${windowMs / 1000}s.`,
        timestamp: Date.now(),
      });
      return;
    }

    next();
  };
}
