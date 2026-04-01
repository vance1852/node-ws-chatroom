# Node.js WebSocket 聊天服务器分析文档

## 1. 消息处理完整流程

当一个用户在聊天室发送一条消息时，消息从接收到发送给同房间其他用户的完整链路如下：

### 1.1 消息接收阶段
1. **WebSocket 连接建立**：在 `src/index.js:22` 创建 `WebSocketServer` 实例
2. **客户端连接处理**：`ConnectionHandler.init()` 监听 `connection` 事件（`src/handlers/ConnectionHandler.js:17`），为每个客户端生成唯一 `clientId`
3. **消息事件监听**：为每个客户端的 WebSocket 绑定 `message` 事件（`src/handlers/ConnectionHandler.js:43`）

### 1.2 消息处理阶段
4. **原始消息接收**：`ws.on('message')` 触发，调用 `_handleMessage(clientId, client, raw)`（`src/handlers/ConnectionHandler.js:69`）
5. **消息验证**：使用 `MessageValidator.validate(raw)` 验证消息格式（`src/handlers/ConnectionHandler.js:70`）
6. **构建消息上下文**：创建包含 `clientId`、`client`、`message`、`reply` 函数的上下文对象（`src/handlers/ConnectionHandler.js:81-86`）
7. **中间件管道执行**：调用 `pipeline.execute(context, finalHandler)`（`src/handlers/ConnectionHandler.js:88-91`）

### 1.3 中间件处理阶段
8. **速率限制**：`rateLimiter` 中间件检查用户是否超过消息频率限制（`src/middleware/rateLimiter.js:19-47`）
9. **消息日志记录**：`messageLogger` 中间件记录消息信息和统计数据（`src/middleware/messageLogger.js:11-28`）
10. **敏感词过滤**：`wordFilter` 中间件对聊天和私聊消息进行敏感词替换（`src/middleware/wordFilter.js:16-40`）

### 1.4 消息路由与发送阶段
11. **消息路由**：中间件管道执行完成后，调用 `messageRouter.route(ctx)`（`src/handlers/MessageRouter.js:22-36`）
12. **选择处理函数**：根据消息类型（如 `chat`）选择对应的处理函数（`_handleChat`）（`src/handlers/MessageRouter.js:77-105`）
13. **获取房间**：通过 `roomManager.getRoomForClient(clientId)` 获取用户所在的房间（`src/handlers/MessageRouter.js:78`）
14. **构建广播消息**：创建包含发送者、内容、时间戳等信息的聊天消息对象（`src/handlers/MessageRouter.js:88-96`）
15. **房间广播**：调用 `room.broadcast(chatMessage, clientId)` 将消息发送给房间内其他用户（`src/rooms/Room.js:39-49`）
16. **逐个发送**：遍历房间内所有客户端，排除发送者本人，通过 `client.ws.send()` 发送消息（`src/rooms/Room.js:44-47`）

---

## 2. 中间件管道分析

### 2.1 中间件执行顺序
中间件在 `src/middleware/pipeline.js:6-10` 中按以下顺序注册和执行：

| 执行顺序 | 中间件名称 | 文件名 |
|---------|-----------|--------|
| 1 | rateLimiter | src/middleware/rateLimiter.js |
| 2 | messageLogger | src/middleware/messageLogger.js |
| 3 | wordFilter | src/middleware/wordFilter.js |

### 2.2 各中间件详细功能

| 中间件 | 功能描述 | 对上下文的操作 | 中断条件 |
|-------|---------|---------------|---------|
| **rateLimiter** | 限制每个用户在固定时间窗口内的消息数量，防止刷屏攻击 | 无修改 | 当用户在 `windowMs`（默认10秒）内发送超过 `maxMessages`（默认20条）消息时，直接返回错误，不继续执行后续中间件 |
| **messageLogger** | 记录所有收到的消息日志，统计总消息数和各类型消息数 | 在 `context` 中添加 `auditStats` 字段，包含统计数据 | 从不中断，总是调用 `next()` 继续执行 |
| **wordFilter** | 对 `chat` 和 `whisper` 类型的消息进行敏感词过滤，将匹配到的词替换为 `***` | 如果检测到敏感词，更新 `context.message` 为过滤后的内容，并添加 `_filtered: true` 标记 | 从不中断，总是调用 `next()` 继续执行 |

### 2.3 中间件管道工作原理
中间件管道采用责任链模式实现（`src/middleware/pipeline.js:13-26`）：
- 每个中间件接收 `context` 和 `next` 函数两个参数
- 中间件处理完自己的逻辑后，必须调用 `next()` 才能让链继续到下一个中间件
- 如果某个中间件不调用 `next()`，则链中断，不会执行后续中间件和最终处理函数
- 所有中间件执行完毕后，调用传入的 `finalHandler`（即 `messageRouter.route`）

---

## 3. 核心组件关系图

```
index.js (入口)
├── WebSocketServer
├── RoomManager (房间管理)
│   └── Room (单个房间，包含客户端列表和广播功能)
├── MessageRouter (消息路由)
│   ├── _handleJoin
│   ├── _handleLeave
│   ├── _handleChat (核心聊天消息处理)
│   ├── _handleWhisper
│   ├── _handleNick
│   └── ...
├── MiddlewarePipeline (中间件管道)
│   ├── rateLimiter
│   ├── messageLogger
│   └── wordFilter
└── ConnectionHandler (连接管理)
    ├── 管理所有客户端连接
    ├── 监听 message 事件
    └── 触发中间件管道
```
