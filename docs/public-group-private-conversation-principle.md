# 公开群聊入口与个人会话隔离原则

日期：2026-06-19

## 核心结论

CodexBridge 的长期产品原则是：

> 群聊是免费公开体验入口，不是多人共享 conversation。每个用户在群里也拥有自己的独立 conversation，只是回复公开发回群里。

这条原则优先级高于后续局部功能设计。任何涉及 Telegram/飞书群聊、私聊、用量、付费和会话路由的改动，都应以此为准。

## 为什么这样设计

CodexBridge 当前的增长路径不是企业级多租户 SaaS，而是轻量试用漏斗：

```text
用户进群
  -> 群里 @bot 免费提问
  -> 每天有限额
  -> 答案公开，其他人能看到效果
  -> 满意后付费购买 credits
  -> 付费后解锁私聊和更多额度
```

在这个模型下，群聊的作用是降低体验门槛和制造公开展示效果，不是让群里所有人共享一个 Codex 上下文。

如果把整个群当成一个共享 conversation，会产生几个问题：

- A 的上下文会污染 B 的回答；
- 群聊公开内容可能混入个人上下文；
- 用户会误以为自己在独立使用，但实际在共享会话；
- 用量按人计费时，conversation 却按群共享，产品语义不一致。

因此，正确做法是：

```text
会话归个人
额度归个人
群聊回复公开
私聊回复私有
```

## 路由原则

### 群聊

群聊是公开 delivery surface，但 conversation 仍按用户隔离。

```text
conversationKey = channel + groupChatId + userId
usageUserKey = channel + userId
deliveryScope = group_public
accessMode = free_daily_or_paid
```

示例：

```text
telegram:chat:-100123:user:456
feishu:chat:oc_xxx:user:ou_yyy
```

含义：

- 同一个群里，不同用户是不同 conversation；
- 同一个用户在不同群里，也是不同 conversation；
- 回复发在群里，所有群成员可见；
- 用量永远记到发起用户身上；
- 群聊上下文不能自动进入用户私聊 conversation。

### 私聊

私聊是付费私有入口，conversation 按用户隔离。

```text
conversationKey = channel + private + userId
usageUserKey = channel + userId
deliveryScope = private
accessMode = paid_only
```

示例：

```text
telegram:private:user:456
feishu:private:user:ou_yyy
```

含义：

- 私聊内容只返回给用户本人；
- 私聊 conversation 默认不读取群聊 conversation；
- 私聊是付费能力；
- 没有 paid credits 或 private unlock 时，应提示用户先去群里免费体验或充值。

## 群聊与私聊是否共享上下文

默认不共享。

```text
群聊 conversation != 私聊 conversation
```

原因：

- 群聊是公开场景，不应污染私人上下文；
- 私聊可能包含私人信息，不应影响公开群聊回答；
- 用户心智更清楚：群里是公开试用，私聊是私人空间。

未来可以考虑显式开关，但不能作为默认行为：

```text
link_private_context = false
```

## 权限与额度原则

用户状态保持轻量：

```text
free
paid
banned
admin
```

群聊规则：

- 免费用户可以在群聊使用；
- 每个用户每天有免费额度；
- 群聊需要显式 @bot 或命令触发；
- 超出每日免费额度后，可以提示充值；
- 付费用户在群聊中可以继续消耗 paid credits；
- 回复公开发回群里。

私聊规则：

- 免费用户默认不能私聊使用；
- 私聊提示应引导用户去群里免费体验或充值解锁；
- 付费用户私聊消耗 paid credits；
- 私聊拥有独立 conversation。

## 最小数据模型

短期不需要 Account / Tenant / Workspace 的重模型。推荐先保留轻量模型：

```text
User
  id = channel:userId
  channel
  externalUserId
  displayName
  status = free | paid | banned | admin
  privateEnabled
  createdAt
  lastSeenAt

Group
  id = channel:chatId
  channel
  externalChatId
  title
  enabled
  dailyFreeLimit
  requireMention

Conversation
  id
  userId
  channel
  scope = group | private
  groupId nullable
  codexThreadId
  createdAt
  updatedAt

CreditBalance
  userId
  paidCredits
  dailyFreeDate
  dailyFreeUsed
  totalUsed

Run
  id
  userId
  conversationId
  channel
  chatType = group | private
  visibility = public | private
  costSource = daily_free | paid_credit
  creditsCharged
  status
  createdAt
```

## Scale 原则

这个轻模型可以 scale，但必须从一开始保留三个工程边界：

1. **Run 是一等对象。** 每次请求都应创建 run record，不能只靠 session 和 balance。
2. **UsageEvent 是账务依据。** 余额可以缓存，但收费、赠送、退款和调整必须有 ledger。
3. **Worker 是执行抽象。** 早期 worker 是本机 Codex；以后可以扩展为多台 Mac mini 或远程 worker pool。

产品模型保持轻：

```text
User
Group
Conversation
Run
UsageEvent
CreditBalance
```

工程实现可以逐步演进：

```text
V1: 单机 + JSON/SQLite + 本机 Codex worker
V2: 单机 + SQLite + 持久 run queue
V3: 多节点 + Postgres/Redis + Codex worker pool
```

## 对当前代码的含义

当前会话路由：

```text
私聊: channel:user:<userId>
群聊: channel:chat:<chatId>:user:<userId>
```

这个方向是正确的。不要把群聊改成 group-shared conversation。

应该补的是：

- 免费用户私聊禁用；
- 群聊每日免费额度；
- paid credits；
- user status；
- run record；
- usage ledger；
- 群聊公开回复但个人 conversation 隔离的文档和测试。

## 一句话原则

> 群聊是公开试用入口；conversation 永远属于发起用户；用量永远记到发起用户；私聊是付费私人入口。

