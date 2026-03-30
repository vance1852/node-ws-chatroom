import { Logger } from "../utils/Logger.js";

const logger = new Logger("MessageAudit");

export function messageLogger() {
  const stats = {
    totalMessages: 0,
    byType: {},
  };

  return (context, next) => {
    const { message, clientId, client } = context;

    stats.totalMessages++;
    stats.byType[message.type] = (stats.byType[message.type] || 0) + 1;

    logger.info(`Message received`, {
      clientId,
      nickname: client.nickname,
      type: message.type,
      room: client.currentRoom,
      contentLength: message.content ? message.content.length : 0,
    });

    context.auditStats = stats;

    next();
  };
}
