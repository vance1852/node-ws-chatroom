import { Logger } from "../utils/Logger.js";

export class Room {
  constructor(name, options = {}) {
    this.name = name;
    this.clients = new Map();
    this.maxClients = options.maxClients || 50;
    this.createdAt = Date.now();
    this.messageCount = 0;
    this.logger = new Logger(`Room:${name}`);
  }

  addClient(clientId, client) {
    if (this.clients.size >= this.maxClients) {
      throw new Error(`Room "${this.name}" is full (max: ${this.maxClients})`);
    }
    this.clients.set(clientId, client);
    this.logger.info(`Client joined`, {
      clientId,
      nickname: client.nickname,
      total: this.clients.size,
    });
  }

  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      this.logger.info(`Client left`, {
        clientId,
        nickname: client.nickname,
        total: this.clients.size,
      });
      return client;
    }
    return null;
  }

  broadcast(message, excludeId = null) {
    this.messageCount++;
    const payload =
      typeof message === "string" ? message : JSON.stringify(message);

    for (const [id, client] of this.clients) {
      if (id !== excludeId && client.ws.readyState === 1) {
        client.ws.send(payload);
      }
    }
  }

  getClientList() {
    return Array.from(this.clients.entries()).map(([id, client]) => ({
      id,
      nickname: client.nickname,
      joinedAt: client.joinedRoomAt,
    }));
  }

  isEmpty() {
    return this.clients.size === 0;
  }

  getStats() {
    return {
      name: this.name,
      clients: this.clients.size,
      maxClients: this.maxClients,
      messageCount: this.messageCount,
      createdAt: this.createdAt,
    };
  }
}
