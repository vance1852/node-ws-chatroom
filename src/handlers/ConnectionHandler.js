import { v4 as uuidv4 } from "uuid";
import { MessageValidator } from "../utils/MessageValidator.js";
import { Logger } from "../utils/Logger.js";

const logger = new Logger("ConnectionHandler");

export class ConnectionHandler {
  constructor(wss, roomManager, messageRouter, middlewarePipeline) {
    this.wss = wss;
    this.roomManager = roomManager;
    this.messageRouter = messageRouter;
    this.pipeline = middlewarePipeline;
    this.clients = new Map();
  }

  init() {
    this.wss.on("connection", (ws, req) => {
      const clientId = uuidv4();
      const clientIp =
        req.headers["x-forwarded-for"] || req.socket.remoteAddress;

      const client = {
        ws,
        id: clientId,
        ip: clientIp,
        nickname: `User_${clientId.slice(0, 6)}`,
        currentRoom: null,
        connectedAt: Date.now(),
        joinedRoomAt: null,
      };

      this.clients.set(clientId, client);
      logger.info(`Client connected`, { clientId, ip: clientIp });

      this._sendToClient(ws, {
        type: "welcome",
        content: `Welcome! Your nickname is ${client.nickname}. Use "nick" to change it, "join" to enter a room.`,
        clientId,
        nickname: client.nickname,
        timestamp: Date.now(),
      });

      ws.on("message", (raw) => {
        this._handleMessage(clientId, client, raw.toString());
      });

      ws.on("close", (code, reason) => {
        logger.info(`Client disconnected`, {
          clientId,
          code,
          reason: reason.toString(),
        });
        this.roomManager.leaveCurrentRoom(clientId);
        this.clients.delete(clientId);
      });

      ws.on("error", (err) => {
        logger.error(`WebSocket error`, { clientId, error: err.message });
      });

      ws.on("pong", () => {
        client.isAlive = true;
      });
    });

    this._startHeartbeat();
  }

  _handleMessage(clientId, client, raw) {
    const validation = MessageValidator.validate(raw);

    if (!validation.valid) {
      this._sendToClient(client.ws, {
        type: "error",
        content: validation.error,
        timestamp: Date.now(),
      });
      return;
    }

    const context = {
      clientId,
      client,
      message: validation.message,
      reply: (msg) => this._sendToClient(client.ws, msg),
    };

    this.pipeline.execute(context, (ctx) => {
      this.messageRouter.route(ctx);
    });
  }

  _sendToClient(ws, message) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }

  _startHeartbeat() {
    const interval = setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (client.isAlive === false) {
          logger.warn(`Client heartbeat timeout`, { clientId });
          client.ws.terminate();
          this.roomManager.leaveCurrentRoom(clientId);
          this.clients.delete(clientId);
          continue;
        }
        client.isAlive = false;
        client.ws.ping();
      }
    }, 30000);

    this.wss.on("close", () => clearInterval(interval));
  }
}
