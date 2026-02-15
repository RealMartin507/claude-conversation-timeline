# 🔧 时间轴开发修复记录 (v1.2.0 / 2026-02-15)

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

---

## 📋 修复历程

| 版本 | 问题 | 根因 | 修复方式 |
|------|------|------|---------|
| v1.1.0 | 连续对话后小圆点不更新 | Claude 回复后替换 DOM 容器，Observer 仍监听旧容器 | 在 recalculate 中检测容器失效并重绑定 |
| v1.2.0 | 新对话首次初始化后小圆点不增加 | 仅 1 条消息时 findCommonAncestor 锁定范围过窄 | 强制使用 ScrollContainer 作为监听目标 |
| v1.2.0 | 架构优化 | 双 Observer 冗余、全局查询低效 | 合并为单一智能 Observer + 限定范围查询 |

---

## 📁 关键文件

- `content.js` — 全部时间轴逻辑（TimelineManager 类）
- `styles.css` — 时间轴 UI 样式（支持暗色主题）
- `manifest.json` — Chrome 扩展配置
