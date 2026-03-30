const VALID_TYPES = [
  "join",
  "leave",
  "chat",
  "whisper",
  "nick",
  "list_rooms",
  "list_users",
];
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NICKNAME_LENGTH = 20;
const NICKNAME_PATTERN = /^[a-zA-Z0-9_\u4e00-\u9fa5]{1,20}$/;

export class MessageValidator {
  static validate(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { valid: false, error: "Invalid JSON format" };
    }

    if (!parsed.type || !VALID_TYPES.includes(parsed.type)) {
      return {
        valid: false,
        error: `Invalid message type. Must be one of: ${VALID_TYPES.join(", ")}`,
      };
    }

    if (parsed.type === "chat" || parsed.type === "whisper") {
      if (!parsed.content || typeof parsed.content !== "string") {
        return {
          valid: false,
          error: "Message content is required and must be a string",
        };
      }
      if (parsed.content.length > MAX_MESSAGE_LENGTH) {
        return {
          valid: false,
          error: `Message exceeds max length of ${MAX_MESSAGE_LENGTH}`,
        };
      }
    }

    if (parsed.type === "join") {
      if (!parsed.room || typeof parsed.room !== "string") {
        return { valid: false, error: "Room name is required for join" };
      }
    }

    if (parsed.type === "whisper") {
      if (!parsed.target || typeof parsed.target !== "string") {
        return { valid: false, error: "Target user is required for whisper" };
      }
    }

    if (parsed.type === "nick") {
      if (!parsed.nickname || !NICKNAME_PATTERN.test(parsed.nickname)) {
        return {
          valid: false,
          error: `Nickname must match pattern: ${NICKNAME_PATTERN}`,
        };
      }
      if (parsed.nickname.length > MAX_NICKNAME_LENGTH) {
        return {
          valid: false,
          error: `Nickname exceeds max length of ${MAX_NICKNAME_LENGTH}`,
        };
      }
    }

    return { valid: true, message: parsed };
  }
}
