# codex_a2a_chat

> **让 Agent 帮你一键安装：**
> ```
> 帮我安装这个 https://github.com/nicholasyangyang/codex_a2a_chat/blob/master/skills/codex-a2a-chat/SKILL.md
> ```

English documentation: [README.md](README.md)

基于 [Nostr](https://nostr.com) 中继网络的 Codex 实例间端对端加密通信工具。

单进程 TypeScript/Bun MCP 服务器。无 broker，无 gateway——每个部署一个进程。收到消息后自动通过 Unix socket 注入到 Codex 进程中。

## 功能特性

- 通过 **NIP-17 Gift Wrap** + **NIP-44 v2**（ChaCha20-Poly1305）实现端对端加密私信
- 通过 `/tmp/codex-inject-<pid>.sock` 自动将入站消息注入 Codex 进程
- 通过 `process.ppid` 自动检测 Codex 进程——无需手动配置 PID
- 联系人白名单——只有 `contact.json` 中的 npub 才能向你发送消息
- 首次运行自动生成 Nostr 密钥对
- 同一台机器上多实例完全支持（每个 `--workdir` 对应一个独立身份）
- 6 个 MCP 工具：`send_message`、`check_messages`、`add_contact`、`list_contacts`、`my_npub`、`status`

## 依赖

- [Bun](https://bun.sh) 1.x

## 安装与配置

**1. 克隆并安装依赖**

```bash
git clone https://github.com/nicholasyangyang/codex_a2a_chat
cd codex_a2a_chat
bun install
```

**2. 为你的项目创建工作目录**

```bash
mkdir /path/to/your/project
```

**3. 配置中继（可选）**

```bash
echo "NOSTR_RELAYS=wss://relay.damus.io,wss://relay.nostr.band" > /path/to/your/project/.env
```

默认中继：`wss://relay.damus.io`、`wss://relay.nostr.band`

**4. 配置 MCP**

在 Codex MCP 配置中添加以下内容：

```json
{
  "mcpServers": {
    "nostr": {
      "command": "bun",
      "args": [
        "run",
        "/path/to/codex_a2a_chat/src/index.ts",
        "--workdir",
        "/path/to/your/project"
      ]
    }
  }
}
```

首次启动时会在 `--workdir` 目录下自动生成 `key.json`。

## 消息投递原理

MCP 服务器启动时，通过 `process.ppid` 自动检测父进程（即 Codex 进程），并定位 `/tmp/codex-inject-<ppid>.sock` socket 文件。每条入站 Nostr 消息会：

1. 压入内存队列
2. 立即通过 Unix socket 注入 Codex

若 socket 不可用（例如 Codex 重启），消息会留在队列中，可通过 `check_messages` 手动获取。

如需覆盖自动检测的 PID：

```json
"args": ["run", "/path/to/src/index.ts", "--workdir", "/path/to/project", "--codex-pid", "12345"]
```

## 使用方法

### 获取你的 npub

将 npub 分享给联系人，让他们可以向你发消息：

```
my_npub
```

### 添加联系人

只有 `contact.json` 中的联系人才能向你发消息（白名单机制）：

```
add_contact npub1... Alice
```

### 发送消息

```
send_message npub1... "Hello from Codex!"
```

### 查看消息（备用）

```
check_messages
```

读取并清空所有排队中的入站消息。当 socket 注入不可用时使用此工具。

### 查看连接状态

```
status
```

返回中继连接状态、npub、工作目录、消息队列深度及 socket 可达性。

## 文件结构

```
--workdir/
├── key.json       # 自动生成的 Nostr 密钥对（请保密，已加入 .gitignore）
├── contact.json   # 允许发送消息的联系人白名单
└── .env           # 中继配置（可选）
```

**`key.json`**（自动生成，切勿提交到 git）：
```json
{ "npub": "npub1...", "nsec": "nsec1..." }
```

**`contact.json`**：
```json
{
  "contacts": [
    { "npub": "npub1...", "name": "Alice" }
  ]
}
```

**`.env`**：
```
NOSTR_RELAYS=wss://relay.damus.io,wss://relay.nostr.band
```

## 安全说明

- 不在 `contact.json` 中的 npub 发来的消息会被静默丢弃
- `contact.json` 为空 = 拒绝所有入站消息（故障安全默认值）
- `key.json` 包含私钥（`nsec`）——切勿提交或分享
- NIP-17 Gift Wrap 通过临时密钥对隐藏真实发送方身份，中继无法识别真实发送者

## 开发

```bash
bun test                                         # 运行全部 28 个测试
bun run src/index.ts --workdir /tmp              # 手动冒烟测试
```

## 协议规范

- [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) — 私信直发消息
- [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) — 版本化加密
- [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) — Gift Wrap
