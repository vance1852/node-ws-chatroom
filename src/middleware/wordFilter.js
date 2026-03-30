import { Logger } from "../utils/Logger.js";

const logger = new Logger("WordFilter");

const DEFAULT_BLOCKED_WORDS = ["spam", "abuse", "hack"];

export function wordFilter(options = {}) {
  const blockedWords = options.blockedWords || DEFAULT_BLOCKED_WORDS;
  const replacement = options.replacement || "***";

  const patterns = blockedWords.map((word) => ({
    regex: new RegExp(`\\b${word}\\b`, "gi"),
    word,
  }));

  return (context, next) => {
    const { message } = context;

    if (message.type === "chat" || message.type === "whisper") {
      let filtered = message.content;
      let wasFiltered = false;

      for (const { regex, word } of patterns) {
        if (regex.test(filtered)) {
          filtered = filtered.replace(regex, replacement);
          wasFiltered = true;
          logger.debug(`Filtered word "${word}"`, {
            clientId: context.clientId,
          });
        }
        regex.lastIndex = 0;
      }

      if (wasFiltered) {
        context.message = { ...message, content: filtered, _filtered: true };
      }
    }

    next();
  };
}
