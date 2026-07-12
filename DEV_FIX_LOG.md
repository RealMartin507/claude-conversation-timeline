# 时间轴架构基线 (v1.5.1 / 2026-07-12)

> **读者**：下一个 AI agent  
> **范围**：`content.js`（TimelineManager 类）+ `src/` 数据/定位模块 + `styles.css`

---

## 🚫 不可打破的约束

| # | 约束 | 原因 |
|---|------|------|
| 1 | `conversationContainer` 必须优先 `scrollContainer` | Claude 单消息时 `findCommonAncestor` 锁定范围过窄，后续消息不在监听范围 |
| 2 | `MutationObserver` 回调首行必须 `ensureContainersUpToDate()` | Claude 流式回复结束后整体替换 DOM 容器，需主动检测失效并重绑 |
| 3 | 保持**单一** MutationObserver | 新消息 → RAF 立即渲染；其他变化 → debounce 250ms |
| 4 | 禁止时间轴内部滚动交互 | 设计决策：时间轴固定侧边栏，不做内部虚拟滚动窗口 |
| 5 | dot 点击跳转、active、star 功能不可退化 | 基础用户交互 |
| 6 | Fiber 只能接受当前组件的 `message.uuid` | 递归扫描共享 provider 状态会把多个 DOM 节点误标成同一 UUID |
| 7 | `positionLayout` 建立后，滚动不得重排 dot | 虚拟行挂载/卸载只能更新定位和 active，不得造成节点漂移 |

---

## 🏗️ 核心架构

### API 数据与 UUID 定位（v1.5.0）
```
Claude 会话 API → 标准化消息 → current_leaf 父链 → human markers(UUID)
                                                      ↓
React Fiber 主世界桥接 ← UUID → DOM element → 平滑滚动
```

- API 的 `chat_messages` 是完整 Timeline 的唯一数据源；DOM 不再负责发现历史消息或确定 marker 顺序。
- marker 的 `id`、星标 ID 与定位 ID 均为 API message UUID，禁止退回文本 hash、文本匹配或 index 匹配。
- `conversationCache` 固定保存 `conversationId`、`messages`、`markers`、`domMap`；路由销毁时必须取消 API 请求并清空映射。
- React Fiber 只能由 `src/locator/reactFiberBridge.js`（MAIN world）读取；内容脚本通过 DOM CustomEvent 请求扫描，并读取桥接脚本写入的 UUID 属性。
- API 请求失败时初次加载降级至旧 DOM Timeline，并延迟重试；已成功加载 API 后的短暂请求失败保留上次完整结果。

### Claude 虚拟列表与点击定位（v1.5.1）

2026-07-12 在 Claude 长对话中现场确认：

- API 当前分支有 60 条消息、30 条 human marker；
- 页面初始仅挂载最后 8 条消息（其中 4 条 human）；
- Claude 提供隐藏的 `Load earlier messages` 控件，触发后才建立完整虚拟列表；
- 虚拟行使用 `data-index`、`aria-posinset`、`aria-setsize`，行容器具有绝对 `top`；
- 随滚动挂载的 UUID 数量会变化，DOM 永远只是完整 API 数据的窗口。

点击未挂载 marker 的流程固定为：

```text
marker.uuid
  → 当前 DOM 精确查找
  → 若不存在，触发 Load earlier messages
  → 分段滚动虚拟容器
  → 等待 MutationObserver / RAF
  → 重新按 message.uuid 匹配
  → 平滑滚动到目标
```

严禁递归搜索 Fiber 父级的全部 state/props。共享 conversation provider 包含整段会话的
所有 UUID，递归命中会把不同用户消息标记成同一个 UUID。桥接器只接受组件直接持有的
`memoizedProps.message.uuid` 或 `pendingProps.message.uuid`。

### 稳定空间布局（v1.5.1）

- marker 保存 `branchOrder`（human + assistant 的当前分支行序号），但身份仍仅为 UUID；
- 已挂载 marker 使用真实 DOM 文档坐标；未挂载 marker 在真实物理锚点与虚拟列表边界之间插值；
- 首个用户 marker 归一化为 `n=0`，最后一个用户 marker 归一化为 `n=1`；
- 首次布局写入 `positionLayout` 并按 UUID 锁定；
- 滚动中新挂载的真实坐标只用于跳转，不得覆盖锁定的 `n`；
- marker UUID 集合变化（例如发送新消息）时，布局 key 变化，才允许重新计算。

现场回归结果：30 个 dot 的轨道坐标为首点 `14px`、末点 `719px`；连续滚动使
DOM 映射从 4 增至 9 时，全部 dot 最大漂移为 `0px`。首、中、末 UUID 跳转均成功。

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

### SPA 路由切换初始化（v1.4.3 重写）

**现象**：Claude 切换对话时 URL 先变，但 React 是**原地替换**消息节点（不先清空），旧消息 element 会短暂残留 DOM，导致新 `TimelineManager` 拿到旧消息初始化，dot 混乱。

**解法**：`handleUrlChange()` 时抓住旧对话**第一条消息的 element 引用**（`staleFirstMessage`），用 `MutationObserver`（`domSwapObserver`）监听它何时脱离 DOM，一旦脱离立即初始化新时间轴。2s 超时兜底。

**关键变量**（模块级）：
- `staleFirstMessage`：旧对话首条消息 element，`null` = 无需等待
- `domSwapObserver`：监听 `staleFirstMessage` 脱离的 MutationObserver
- `domSwapDeadline`：超时截止时间戳

**绝对不要**：
- 不要改回"等消息数量归零"策略——Claude SPA 消息从不归零，会卡满 2s
- `stopDomSwapObserver()` 必须在 `handleUrlChange` 和 `ensureTimeline` 退出路径都调用，防止 observer 泄漏

### 竞态防护
- 模块级 `ensureTimelineTimerId`：`ensureTimeline()` 的 setTimeout 有 id 追踪
- `handleUrlChange()`、禁用分支、destroy 前统一 `clearEnsureTimelineTimer()` + `stopDomSwapObserver()`

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
| v1.4.1 | 鱼眼模式修复边界吸附问题 |
| v1.4.2 | 修复 2K 宽屏下错误拾取非滚动区域（`pickScrollContainer` 算法重写，优先考虑实际溢出的 `scrollHeight > clientHeight` 及更内侧 DOM） |
| v1.4.3 | 修复切换对话时 dot 混乱：用 `staleFirstMessage` element 引用 + `domSwapObserver` 等待 React 完成路由替换，替代无效的"等消息数归零"策略；全面添加 `[Timeline]` debug 日志 |
| v1.5.0 | 完整会话改由 Claude API 驱动；按 `current_leaf_message_uuid` 构建当前分支；用 UUID + React Fiber 维护 DOM 定位，保留 DOM 降级路径 |
| v1.5.1 | 适配 Claude 的 `Load earlier messages` + 虚拟行机制；修复未挂载 UUID 点击失败、Fiber 共享状态误匹配、dot 聚集和滚动漂移；首尾节点锁定并完成 Chrome 现场回归 |

---

## 📁 文件

- `content.js` — TimelineManager UI/交互 + 模块级路由/启停控制
- `src/api/`、`src/parser/`、`src/timeline/`、`src/locator/` — API 数据、消息树、marker 与 UUID 定位模块
- `styles.css` — UI 样式（含 aggregate dot、暗色主题）
- `OPTIMIZATION_TODO.md` — 后续优化任务清单
