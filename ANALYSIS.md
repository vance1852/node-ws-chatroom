# Node.js WebSocket 聊天服务器 架构分析

## 目录
1. [消息处理完整链路](#消息处理完整链路)
2. [中间件管道设计](#中间件管道设计)
3. [核心模块关系图](#核心模块关系图)

---

## 消息处理完整链路

当一个用户在聊天室发送一条聊天消息（`type: "chat"`）时，消息从 WebSocket 接收到最终广播给同房间其他用户，经过以下完整步骤：

### 阶段 1：WebSocket 接收
**文件**: `src/handlers/ConnectionHandler.js:43-45`

```javascript
ws.on("message", (raw) => {
  this._handleMessage(clientId, client, raw.toString());
});
```

| 步骤 | 说明 |
|------|------|
| 1.1 | ws 库触发 `message` 事件，接收原始 Buffer 数据 |
| 1.2 | 调用 `_handleMessage` 方法，传入：`clientId`、`client` 对象、转成字符串的原始消息 |

---

### 阶段 2：消息验证
**文件**: `src/handlers/ConnectionHandler.js:69-79`

| 步骤 | 说明 | 上下文操作 |
|------|------|-----------|
| 2.1 | `MessageValidator.validate(raw)` 验证 JSON 格式和必填字段 |
| 2.2 | 验证失败 → 直接回复 error 消息，终止流程 |
| 2.3 | 验证成功 → 解析后的 message 对象存入上下文 |

---

### 阶段 3：构建执行上下文
**文件**: `src/handlers/ConnectionHandler.js:81-86`

```javascript
const context = {
  clientId,
  client,           // 包含 ws、nickname、currentRoom 等
  message,          // 验证后的消息对象
  reply: (msg) => this._sendToClient(client.ws, msg),
};
```

| 步骤 | 说明 |
|------|------|
| 3.1 | `client` 对象包含该连接的所有状态：昵称、当前房间、连接时间等 |
| 3.2 | `reply` 是给发送者回消息的便捷方法 |
| 3.3 | 此 context 对象将贯穿整个中间件和路由流程 |

---

### 阶段 4：中间件管道执行
**文件**: `src/middleware/pipeline.js:13-25`

采用 **责任链模式**，按注册顺序串行执行：

```
rateLimiter → messageLogger → wordFilter → finalHandler
```

| 步骤 | 说明 |
|------|------|
| 4.1 | index 指针从 0 开始 |
| 4.2 | 执行当前中间件，传入 `context` 和 `next` 回调 |
| 4.3 | 任一中间件不调用 `next()` → 链路终止 |
| 4.4 | 全部执行完 → 执行 `finalHandler` 进入路由阶段 |

*详细中间件说明见下一章节*

---

### 阶段 5：消息路由分发
**文件**: `src/handlers/MessageRouter.js:22-36`

| 步骤 | 说明 |
|------|------|
| 5.1 | 根据 `context.message.type` 查找对应 handler |
| 5.2 | chat 类型消息 → 执行 `_handleChat` |
| 5.3 | 找不到对应类型 → 返回错误消息 |

---

### 阶段 6：聊天消息业务处理
**文件**: `src/handlers/MessageRouter.js:77-105`

| 步骤 | 说明 |
|------|------|
| 6.1 | `roomManager.getRoomForClient(clientId)` 验证用户是否在房间内 |
| 6.2 | 不在房间 → 返回错误 |
| 6.3 | 构造最终广播的消息对象：`type`、`sender`、`senderId`、`content`、`room`、`timestamp` |
| 6.4 | **重要**: 若消息被过滤过，携带 `filtered: true` 标记 |
| 6.5 | 给发送者回复 `chat_ack` 确认回执 |

---

### 阶段 7：房间广播
**文件**: `src/rooms/Room.js:39-49`

```javascript
broadcast(message, excludeId = null) {
  for (const [id, client] of this.clients) {
    if (id !== excludeId && client.ws.readyState === 1) {
      client.ws.send(payload);
    }
  }
}
```

| 步骤 | 说明 |
|------|------|
| 7.1 | 遍历房间内所有客户端 |
| 7.2 | **排除发送者本人**（通过 `excludeId` 参数） |
| 7.3 | 检查 WebSocket 连接状态 `readyState === 1` (OPEN) |
| 7.4 | 序列化消息并发送 |

---

## 中间件管道设计

### 执行顺序总览

**注册顺序**: `src/middleware/pipeline.js:6-10`

| 执行顺序 | 中间件 | 文件名 | 核心职责 | 终止链路？ |
|---------|--------|--------|---------|-----------|
| 1 | rateLimiter | `rateLimiter.js` | 频率限制，防止洪水攻击 | **是**，超限时终止 |
| 2 | messageLogger | `messageLogger.js` | 消息审计日志、统计 | 否 |
| 3 | wordFilter | `wordFilter.js` | 敏感词过滤 | 否 |

---

### 各中间件详细分析

#### 1. rateLimiter - 速率限制中间件
**配置**: windowMs=10s, maxMessages=20 条

| 项目 | 说明 |
|------|------|
| **执行时机** | 第一个执行，入口防护 |
| **操作对象** | `context.clientId` |
| **上下文修改** | ✅ **不修改 context** |
| **终止条件** | 单位时间内消息数超过阈值时，直接 reply 错误，**不调用 next()** |
| **副作用** | 内部维护 Map 存储每个 client 的时间窗口和计数，定时清理 |
| **关键代码位置** | `src/middleware/rateLimiter.js:36-44` |

> 💡 设计特点：滑动窗口算法，每 10 秒自动清理过期 bucket

---

#### 2. messageLogger - 消息审计中间件

| 项目 | 说明 |
|------|------|
| **执行时机** | 限速通过后执行 |
| **操作对象** | `context.message`, `context.client` |
| **上下文修改** | ✅ 新增 `context.auditStats`，包含：<br>- `totalMessages`: 总消息数<br>- `byType`: 按类型统计 |
| **终止条件** | **永不终止**，总是调用 next() |
| **副作用** | 输出 INFO 级别日志，记录：发送人、消息类型、房间、内容长度 |
| **关键代码位置** | `src/middleware/messageLogger.js:17-25` |

> 💡 设计特点：闭包维护全局统计 stats，中间件实例单例化

---

#### 3. wordFilter - 敏感词过滤中间件

| 项目 | 说明 |
|------|------|
| **执行时机** | 最后一个业务中间件 |
| **操作对象** | 仅处理 `type: "chat"` 或 `"whisper"` 类型 |
| **上下文修改** | ✅ **修改 `context.message`**:<br>- `content`: 替换为 `***`<br>- 新增 `_filtered: true` 标记 |
| **终止条件** | **永不终止**，总是调用 next() |
| **匹配规则** | 整词匹配 `\b${word}\b`，大小写不敏感 |
| **默认屏蔽词** | spam, abuse, hack |
| **关键代码位置** | `src/middleware/wordFilter.js:16-39` |

> 💡 设计特点：纯函数式处理，过滤后不终止链路，只打标记，由上层业务自行展示 `filtered: true`

---

### 中间件模式总结

```
┌─────────────────────────────────────────────────────────┐
│                    Middleware Pipeline                   │
├─────────────────────────────────────────────────────────┤
│  rateLimiter()                                          │
│      ↓ next()                ↘ return                   │
│  messageLogger()               (terminate)              │
│      ↓ next()                                           │
│  wordFilter()                                           │
│      ↓ next()                                           │
│  MessageRouter.route()                                  │
└─────────────────────────────────────────────────────────┘
```

**设计模式**: 经典 Express 风格的责任链模式
- 优点：可插拔、职责单一、顺序可控
- 约定：`(context, next) => void`
- 每个中间件只关心自己的逻辑，通过 `context` 传递状态

---

## 核心模块关系图

```
src/index.js (入口)
    ├── wss (WebSocketServer)
    │     └── ConnectionHandler
    │           ├── clients Map
    │           ├── heartbeat 心跳检测
    │           └── _handleMessage()
    │                 ↓
    ├── buildMiddlewarePipeline()
    │     ├── rateLimiter
    │     ├── messageLogger
    │     └── wordFilter
    │           ↓
    ├── MessageRouter
    │     ├── join/leave/chat/whisper/nick/...
    │     └── _handleChat → room.broadcast
    │           ↓
    └── RoomManager
          ├── rooms Map (name → Room)
          ├── clientRoomMap (clientId → roomName)
          └── Room
                ├── clients Map
                └── broadcast(message, excludeId)
```

---

## 关键设计要点

1. **无状态设计**: 所有状态通过 `context` 传递，中间件无内部状态（除了闭包缓存）
2. **防御式编程**: 每个边界都有状态检查：连接状态、房间存在性、权限验证
3. **优雅降级**: 敏感词只过滤不拦截，用户体验更友好
4. **资源自动清理**: 空房间自动销毁，超时连接自动断开
