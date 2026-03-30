import { Room } from "./Room.js";
import { Logger } from "../utils/Logger.js";

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.clientRoomMap = new Map();
    this.logger = new Logger("RoomManager");
  }

  getOrCreateRoom(roomName) {
    if (!this.rooms.has(roomName)) {
      const room = new Room(roomName);
      this.rooms.set(roomName, room);
      this.logger.info(`Room created`, { room: roomName });
    }
    return this.rooms.get(roomName);
  }

  joinRoom(roomName, clientId, client) {
    this.leaveCurrentRoom(clientId);

    const room = this.getOrCreateRoom(roomName);
    room.addClient(clientId, client);
    this.clientRoomMap.set(clientId, roomName);

    client.joinedRoomAt = Date.now();
    client.currentRoom = roomName;

    room.broadcast(
      {
        type: "system",
        content: `${client.nickname} joined the room`,
        room: roomName,
        timestamp: Date.now(),
      },
      clientId,
    );

    return room;
  }

  leaveCurrentRoom(clientId) {
    const currentRoomName = this.clientRoomMap.get(clientId);
    if (!currentRoomName) return null;

    const room = this.rooms.get(currentRoomName);
    if (!room) return null;

    const client = room.removeClient(clientId);
    this.clientRoomMap.delete(clientId);

    if (client) {
      room.broadcast({
        type: "system",
        content: `${client.nickname} left the room`,
        room: currentRoomName,
        timestamp: Date.now(),
      });

      client.currentRoom = null;
    }

    if (room.isEmpty()) {
      this.rooms.delete(currentRoomName);
      this.logger.info(`Room destroyed (empty)`, { room: currentRoomName });
    }

    return client;
  }

  getRoomForClient(clientId) {
    const roomName = this.clientRoomMap.get(clientId);
    return roomName ? this.rooms.get(roomName) : null;
  }

  findClientAcrossRooms(nickname) {
    for (const [, room] of this.rooms) {
      for (const [id, client] of room.clients) {
        if (client.nickname === nickname) {
          return { id, client, room };
        }
      }
    }
    return null;
  }

  listRooms() {
    return Array.from(this.rooms.values()).map((room) => room.getStats());
  }

  getStats() {
    return {
      totalRooms: this.rooms.size,
      totalClients: this.clientRoomMap.size,
      rooms: this.listRooms(),
    };
  }

  closeAll() {
    for (const [name, room] of this.rooms) {
      room.broadcast({
        type: "system",
        content: "Server is shutting down",
        timestamp: Date.now(),
      });
    }
    this.rooms.clear();
    this.clientRoomMap.clear();
    this.logger.info("All rooms closed");
  }
}
