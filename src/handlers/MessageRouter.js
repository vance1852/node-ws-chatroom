import { Logger } from "../utils/Logger.js";

const logger = new Logger("MessageRouter");

export class MessageRouter {
  constructor(roomManager) {
    this.roomManager = roomManager;
    this.handlers = new Map();
    this._registerHandlers();
  }

  _registerHandlers() {
    this.handlers.set("join", this._handleJoin.bind(this));
    this.handlers.set("leave", this._handleLeave.bind(this));
    this.handlers.set("chat", this._handleChat.bind(this));
    this.handlers.set("whisper", this._handleWhisper.bind(this));
    this.handlers.set("nick", this._handleNick.bind(this));
    this.handlers.set("list_rooms", this._handleListRooms.bind(this));
    this.handlers.set("list_users", this._handleListUsers.bind(this));
  }

  route(context) {
    const handler = this.handlers.get(context.message.type);
    if (handler) {
      handler(context);
    } else {
      logger.warn(`No handler for message type`, {
        type: context.message.type,
      });
      context.reply({
        type: "error",
        content: `Unknown message type: ${context.message.type}`,
        timestamp: Date.now(),
      });
    }
  }

  _handleJoin({ clientId, client, message, reply }) {
    const roomName = message.room.trim().toLowerCase();

    try {
      const room = this.roomManager.joinRoom(roomName, clientId, client);
      reply({
        type: "joined",
        room: roomName,
        users: room.getClientList(),
        timestamp: Date.now(),
      });
    } catch (err) {
      reply({
        type: "error",
        content: err.message,
        timestamp: Date.now(),
      });
    }
  }

  _handleLeave({ clientId, client, reply }) {
    const roomName = client.currentRoom;
    if (!roomName) {
      reply({
        type: "error",
        content: "You are not in any room",
        timestamp: Date.now(),
      });
      return;
    }

    this.roomManager.leaveCurrentRoom(clientId);
    reply({
      type: "left",
      room: roomName,
      timestamp: Date.now(),
    });
  }

  _handleChat({ clientId, client, message, reply }) {
    const room = this.roomManager.getRoomForClient(clientId);
    if (!room) {
      reply({
        type: "error",
        content: "You must join a room before sending messages",
        timestamp: Date.now(),
      });
      return;
    }

    const chatMessage = {
      type: "chat",
      sender: client.nickname,
      senderId: clientId,
      content: message.content,
      room: room.name,
      timestamp: Date.now(),
      ...(message._filtered && { filtered: true }),
    };

    room.broadcast(chatMessage, clientId);

    reply({
      type: "chat_ack",
      messageId: `${clientId}-${Date.now()}`,
      timestamp: Date.now(),
    });
  }

  _handleWhisper({ clientId, client, message, reply }) {
    const target = this.roomManager.findClientAcrossRooms(message.target);

    if (!target) {
      reply({
        type: "error",
        content: `User "${message.target}" not found`,
        timestamp: Date.now(),
      });
      return;
    }

    if (target.id === clientId) {
      reply({
        type: "error",
        content: "You cannot whisper to yourself",
        timestamp: Date.now(),
      });
      return;
    }

    const whisperMessage = {
      type: "whisper",
      from: client.nickname,
      content: message.content,
      timestamp: Date.now(),
    };

    if (target.client.ws.readyState === 1) {
      target.client.ws.send(JSON.stringify(whisperMessage));
    }

    reply({
      type: "whisper_ack",
      to: message.target,
      timestamp: Date.now(),
    });
  }

  _handleNick({ clientId, client, message, reply }) {
    const oldNickname = client.nickname;
    const newNickname = message.nickname;

    const existing = this.roomManager.findClientAcrossRooms(newNickname);
    if (existing && existing.id !== clientId) {
      reply({
        type: "error",
        content: `Nickname "${newNickname}" is already taken`,
        timestamp: Date.now(),
      });
      return;
    }

    client.nickname = newNickname;

    reply({
      type: "nick_changed",
      oldNickname,
      newNickname,
      timestamp: Date.now(),
    });

    const room = this.roomManager.getRoomForClient(clientId);
    if (room) {
      room.broadcast(
        {
          type: "system",
          content: `${oldNickname} is now known as ${newNickname}`,
          room: room.name,
          timestamp: Date.now(),
        },
        clientId,
      );
    }
  }

  _handleListRooms({ reply }) {
    const rooms = this.roomManager.listRooms();
    reply({
      type: "room_list",
      rooms,
      timestamp: Date.now(),
    });
  }

  _handleListUsers({ clientId, reply }) {
    const room = this.roomManager.getRoomForClient(clientId);
    if (!room) {
      reply({
        type: "error",
        content: "You must join a room to list users",
        timestamp: Date.now(),
      });
      return;
    }

    reply({
      type: "user_list",
      room: room.name,
      users: room.getClientList(),
      timestamp: Date.now(),
    });
  }
}
