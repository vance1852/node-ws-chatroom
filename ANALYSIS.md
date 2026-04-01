# 聊天服务器架构分析

## 一、消息完整处理链路

当用户在聊天室发送一条聊天消息时，完整的处理流程如下：

### 阶段 1：WebSocket 接收消息

| 步骤 | 描述 | 所在文件 |
|------|------|----------|
| 1 | WebSocket 服务器接收到客户端发送的原始二进制数据 | `src/handlers/ConnectionHandler.js:43` |
| 2 | 调用 `_handleMessage()` 方法，将原始 Buffer 转为字符串 | `src/handlers/ConnectionHandler.js:44` |
| 3 | `MessageValidator.validate()` 验证 JSON 格式和消息结构合法性 | `src/handlers/ConnectionHandler.js:70` |
| 4 | 验证失败直接返回 error 消息给客户端，终止流程 | `src/handlers/ConnectionHandler.js:72-79` |
| 5 | 构建消息上下文对象，包含 clientId、client 对象、解析后的 message、reply 方法 | `src/handlers/ConnectionHandler.js:81-86` |

### 阶段 2：中间件管道处理

```
上下文对象 → rateLimiter → messageLogger → wordFilter → MessageRouter
```

详细说明见下文「中间件管道分析」章节。

### 阶段 3：消息路由分发

| 步骤 | 描述 | 所在文件 |
|------|------|----------|
| 1 | `MessageRouter.route()` 根据 message.type 匹配对应处理器 | `src/handlers/MessageRouter.js:22-36` |
| 2 | 匹配到 `chat` 类型，执行 `_handleChat()` | `src/handlers/MessageRouter.js:77` |
| 3 | 通过 `roomManager.getRoomForClient()` 检查用户是否已加入房间 | `src/handlers/MessageRouter.js:78` |
| 4 | 未加入房间则返回 error，终止流程 | `src/handlers/MessageRouter.js:80-86` |
| 5 | 构建最终聊天消息对象，包含 sender、senderId、content、room、timestamp | `src/handlers/MessageRouter.js:88-96` |
| 6 | 若经过敏感词过滤，附加 `filtered: true` 标记 | `src/handlers/MessageRouter.js:95` |

### 阶段 4：房间广播

| 步骤 | 描述 | 所在文件 |
|------|------|----------|
| 1 | 调用 `room.broadcast()`，传入消息对象和排除的发送者 ID | `src/handlers/MessageRouter.js:98` |
| 2 | 房间消息计数 +1 | `src/rooms/Room.js:40` |
| 3 | 消息对象序列化为 JSON 字符串 | `src/rooms/Room.js:41-42` |
| 4 | 遍历房间内所有客户端 | `src/rooms/Room.js:44` |
| 5 | 排除发送者本人，检查 WebSocket 连接状态为 OPEN (readyState === 1) | `src/rooms/Room.js:45` |
| 6 | 通过 ws.send() 将消息发送给同房间其他所有在线用户 | `src/rooms/Room.js:46` |

### 阶段 5：发送确认

| 步骤 | 描述 | 所在文件 |
|------|------|----------|
| 1 | 向发送者本人返回 chat_ack 确认消息，附带 messageId | `src/handlers/MessageRouter.js:100-104` |

---

## 二、中间件管道分析

### 执行顺序

中间件执行顺序在 `src/middleware/pipeline.js:6-10` 中定义：

```
1. rateLimiter → 2. messageLogger → 3. wordFilter → finalHandler (MessageRouter)
```

采用洋葱圈模型的简化版（单向），通过 next() 函数依次调用下一个中间件。

---

### 中间件详细说明

| 执行顺序 | 中间件名称 | 主要功能 | 对上下文的操作 | 所在文件 |
|---------|-----------|----------|---------------|----------|
| **1** | **rateLimiter** | 客户端限流，防止消息洪水攻击 | ✅ **检查**：为每个客户端维护滑动窗口计数<br>✅ **拦截**：超过阈值（10秒20条）直接调用 reply() 返回错误，不调用 next() 终止流程<br>✅ **无修改**：不修改 context 原有属性 | `src/middleware/rateLimiter.js` |
| **2** | **messageLogger** | 消息审计日志和统计 | ✅ **新增属性**：`context.auditStats` 全局统计对象，包含 totalMessages 总消息数、byType 按类型统计<br>✅ **日志输出**：记录每条消息的 clientId、昵称、类型、房间、内容长度<br>✅ **无拦截**：始终调用 next() | `src/middleware/messageLogger.js` |
| **3** | **wordFilter** | 敏感词过滤 | ✅ **条件修改**：仅对 chat/whisper 类型消息生效<br>✅ **替换内容**：检测到屏蔽词（spam/abuse/hack）时替换为 ***<br>✅ **标记**：`context.message._filtered = true` 标记已过滤<br>✅ **无拦截**：始终调用 next() | `src/middleware/wordFilter.js` |

---

## 三、关键设计说明

### 1. 中间件管道设计

采用职责链模式，核心实现于 `src/middleware/pipeline.js:13-26`：
- 使用闭包维护 index 指针
- next() 函数递归调用下一个中间件
- 中间件可选择是否调用 next() 来决定是否继续流程
- 所有中间件共享同一个 context 对象，便于传递状态

### 2. 房间管理架构

- **RoomManager**：全局房间注册表，维护 client ↔ room 映射关系
- **Room**：单个房间实例，维护客户端列表和广播逻辑
- 空房间自动销毁机制
- 加入新房间时自动离开原房间

### 3. 核心上下文对象结构

```javascript
context = {
  clientId: string,           // 客户端唯一ID
  client: object,             // 客户端完整对象
  message: object,            // 解析并验证后的消息
  reply: Function,            // 向当前客户端发消息
  // 中间件附加属性
  auditStats?: object         // messageLogger 附加
  message._filtered?: boolean // wordFilter 附加
}
```
