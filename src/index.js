import { createServer } from "http";
import { WebSocketServer } from "ws";
import { RoomManager } from "./rooms/RoomManager.js";
import { ConnectionHandler } from "./handlers/ConnectionHandler.js";
import { MessageRouter } from "./handlers/MessageRouter.js";
import { buildMiddlewarePipeline } from "./middleware/pipeline.js";
import { Logger } from "./utils/Logger.js";

const PORT = process.env.PORT || 3000;
const logger = new Logger("Main");

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: roomManager.getStats() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });
const roomManager = new RoomManager();
const messageRouter = new MessageRouter(roomManager);
const middlewarePipeline = buildMiddlewarePipeline();
const connectionHandler = new ConnectionHandler(
  wss,
  roomManager,
  messageRouter,
  middlewarePipeline,
);

connectionHandler.init();

server.listen(PORT, () => {
  logger.info(`Chat server running on port ${PORT}`);
});

process.on("SIGINT", () => {
  logger.info("Shutting down...");
  roomManager.closeAll();
  wss.close(() => {
    server.close(() => process.exit(0));
  });
});
