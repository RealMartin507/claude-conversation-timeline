# 🔧 时间轴开发修复记录 (v1.2.1 / 2026-04-22)

本项目灵感源自 [chatgpt-conversation-timeline](https://github.com/Reborn14/chatgpt-conversation-timeline)，为 Claude.ai 实现时间轴功能。  
Claude 的 DOM 结构比 ChatGPT 更复杂（深度嵌套、无稳定消息 ID），因此有独特的适配需求。

---

## ⚠️ 核心设计决策（请勿随意修改）

### 1. 容器定位：强制使用 ScrollContainer

```javascript
// findCriticalElements() 中的关键逻辑 —— 请勿改回 findCommonAncestor
if (scrollContainer instanceof Element && scrollContainer !== document.body) {
  this.conversationContainer = this.scrollContainer;  // 强制使用滚动容器
} else {
  this.conversationContainer = findCommonAncestor(messages) || document.body;
}
```

**为什么不能用 `findCommonAncestor`？**  
Claude 新对话只有 1 条消息时，ancestor 会锁定到该消息的直接父 Wrapper，后续兄弟消息全部不在监听范围内。  
ChatGPT 不需要这个处理，因为它的 `article[data-turn-id]` 是扁平列表结构，`parentElement` 天然就是对话容器。

### 2. 主动容器验证：ensureContainersUpToDate

Claude 在用户发送消息并收到回复后，会替换 DOM 容器（React 重渲染）。  
在每次 MutationObserver 回调中，先调用 `ensureContainersUpToDate()` 主动检测容器是否失效，失效则自动重绑定。  
**注意**：`ensureContainersUpToDate` 内部使用 `document.querySelectorAll`（全局查询），因为旧容器已脱离 DOM。

### 3. 统一 MutationObserver

只有一个 `mutationObserver`，回调中智能判断：
- **有新用户消息** → `requestAnimationFrame` 立即渲染（零延迟）
- **其他 DOM 变化** → 防抖 250ms 后渲染（避免流式回复频繁触发）

`rebindObservers()` 仅 disconnect + re-observe，不重建 Observer 实例。

### 4. 限定范围查询

`recalculateAndRenderMarkers()` 中使用 `this.conversationContainer.querySelectorAll()`，而非 `document.querySelectorAll()`。  
减少 DOM 遍历范围，更安全、更快。

### 5. 切换会话稳定性：延迟初始化 + 过滤无效消息

Claude 在切换左侧会话时，旧会话 DOM 与新会话 DOM 会短暂共存，且外层可能出现“`overflow-y-auto` 但不可滚动”的假容器。  
因此：

- 初始化前，先等待当前会话 DOM 稳定（消息数连续两次一致）
- 仅采信 **可见、已连接、有实际文本** 的 `user-message`
- `pickScrollContainer()` 必须排除 `scrollHeight === clientHeight` 的假滚动容器

**注意**：这条是对前 4 条的补强，不是替代。  
尤其不能因此把 `recalculateAndRenderMarkers()` 改回全局查询。

---

## 📋 修复历程

| 版本 | 问题 | 根因 | 修复方式 |
|------|------|------|---------|
| v1.1.0 | 连续对话后小圆点不更新 | Claude 回复后替换 DOM 容器，Observer 仍监听旧容器 | 在 recalculate 中检测容器失效并重绑定 |
| v1.2.0 | 新对话首次初始化后小圆点不增加 | 仅 1 条消息时 findCommonAncestor 锁定范围过窄 | 强制使用 ScrollContainer 作为监听目标 |
| v1.2.0 | 架构优化 | 双 Observer 冗余、全局查询低效 | 合并为单一智能 Observer + 限定范围查询 |
| v1.2.1 | 点击 dot 不跳转 / active 不跟随 | 误选了 `overflow-y-auto` 但不可滚动的外层容器 | `pickScrollContainer()` 增加真实可滚动距离判断 |
| v1.2.1 | 切换会话后 dot 挤在一起、后续失效 | Claude 切会话时旧 DOM / 新 DOM 短暂共存，初始化过早拿到过渡态消息集 | 初始化前等待会话稳定；过滤无效 `user-message`；仍保持限定范围查询 |

---

## 📁 关键文件

- `content.js` — 全部时间轴逻辑（TimelineManager 类）
- `styles.css` — 时间轴 UI 样式（支持暗色主题）
- `manifest.json` — Chrome 扩展配置
