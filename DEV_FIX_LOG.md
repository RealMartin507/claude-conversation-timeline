# 时间轴架构基线 (v1.4.0 / 2026-02-17)

> **读者**：下一个 AI agent  
> **范围**：`content.js`（TimelineManager 类）+ `styles.css`

---

## 🚫 不可打破的约束

| # | 约束 | 原因 |
|---|------|------|
| 1 | `conversationContainer` 必须优先 `scrollContainer` | Claude 单消息时 `findCommonAncestor` 锁定范围过窄，后续消息不在监听范围 |
| 2 | `MutationObserver` 回调首行必须 `ensureContainersUpToDate()` | Claude 流式回复结束后整体替换 DOM 容器，需主动检测失效并重绑 |
| 3 | 保持**单一** MutationObserver | 新消息 → RAF 立即渲染；其他变化 → debounce 250ms |
| 4 | 禁止时间轴内部滚动交互 | 设计决策：时间轴固定侧边栏，不做内部虚拟滚动窗口 |
| 5 | dot 点击跳转、active、star 功能不可退化 | 基础用户交互 |

---

## 🏗️ 核心架构

### 容器链
```
pickScrollContainer(messages)  →  scrollContainer（滚动监听+位置计算）
findCommonAncestor(messages)   →  conversationContainer（MutationObserver 目标）
优先级：scrollContainer > commonAncestor > document.body
```

### 容器热更新
- 每次 Mutation 回调触发时调用 `ensureContainersUpToDate()` 检测容器有效性
- 失效时：全局重新查找 → 保存旧 `scrollContainer` → `rebindObservers({ oldScrollContainer })` → `recalculateAndRenderMarkers()`
- **关键**：`rebindScrollListener(oldScrollContainer)` 必须用旧引用移除监听，防止泄漏

### 鱼眼模式渲染（v1.4.0）
```
renderDots():
  maxFitDots = floor(usable / minGap) + 1
  
  IF markers.length <= maxFitDots:
    简单模式：全部独立 dot + applyMinGap
  ELSE:
    鱼眼模式：
      activeIndex = scrubFocusIndex >= 0 ? scrubFocusIndex : activeTurnId 的索引
      focusSlots = max(1, maxFitDots - 2)
      计算 focusStart/focusEnd（靠边缘时自动调整）
      
      渲染项：
        上方聚合 dot（如果 focusStart > 0）
        焦点区独立 dot（focusStart..focusEnd）
        下方聚合 dot（如果 focusEnd < length-1）
```

**关键状态**：
- `fisheyeMode`：当前是否鱼眼模式
- `focusStart/focusEnd`：焦点窗口范围
- `scrubFocusIndex`：wheel 刷卡时的临时焦点（-1 = 跟随 active）

**焦点跟随**：
- `updateActiveFromScroll/Visible()` 中，active 变化时检查是否越界
- 越界时调用 `renderDots()` 重新渲染，否则仅 `applyActiveState()` 切换 CSS
- scroll 事件触发时清除 `scrubFocusIndex`，焦点回到 active

**Wheel 刷卡**：
- 鱼眼模式下，时间轴上 wheel 事件被拦截（`preventDefault`）
- 焦点索引按 SCRUB_STEP=3 移动，触发 `renderDots()`
- 简单模式下不拦截，正常滚动页面

### 竞态防护
- 模块级 `ensureTimelineTimerId`：`ensureTimeline()` 的 setTimeout 有 id 追踪
- `handleUrlChange()`、禁用分支、destroy 前统一 `clearEnsureTimelineTimer()`

### 防抖统一
- `ResizeObserver`、`window.resize`、`themeObserver` 全走 `debouncedRecalculate()`（250ms）
- 新消息走 RAF（不防抖）

---

## 📋 版本历程

| 版本 | 关键更新 |
|------|----------|
| v1.1-1.2 | 容器热更新、单一 Observer |
| v1.3 | 密度分桶聚合、竞态防护、监听泄漏修复 |
| v1.4 | 鱼眼模式（Focus+Context）、wheel 刷卡浏览 |

---

## 📁 文件

- `content.js` — 全部逻辑（TimelineManager + 模块级路由/启停控制）
- `styles.css` — UI 样式（含 aggregate dot、暗色主题）
- `OPTIMIZATION_TODO.md` — 后续优化任务清单
