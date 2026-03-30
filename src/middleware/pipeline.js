import { rateLimiter } from "./rateLimiter.js";
import { wordFilter } from "./wordFilter.js";
import { messageLogger } from "./messageLogger.js";

export function buildMiddlewarePipeline() {
  const middlewares = [
    rateLimiter({ windowMs: 10000, maxMessages: 20 }),
    messageLogger(),
    wordFilter(),
  ];

  return {
    execute(context, finalHandler) {
      let index = 0;

      function next() {
        if (index < middlewares.length) {
          const middleware = middlewares[index++];
          middleware(context, next);
        } else {
          finalHandler(context);
        }
      }

      next();
    },
  };
}
