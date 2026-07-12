# Timeline TODO（给 AI Agent）

> **读者**：新 AI agent  
> **前置**：先读 `DEV_FIX_LOG.md` 了解架构基线  
> **范围**：`content.js`、`src/`、`styles.css`
> **当前版本**：1.5.1

---

## 🚫 硬规则（必须遵守）

1. 保持 `DEV_FIX_LOG.md` 中的 5 条不可打破约束
2. 禁止引入"时间轴内部滚动"交互模型（有自己滚动条的那种）
3. dot 点击跳转、active、star 功能不可退化

---

## ✅ 已完成（v1.4.0，勿重复实现）

**v1.3.0**：容器热更新、竞态防护、统一防抖、密度分桶聚合、监听泄漏修复

**v1.4.0**：鱼眼模式（Focus+Context）
- 简单模式 vs 鱼眼模式自动切换（基于 `maxFitDots`）
- 焦点区展开为独立 dot，远区折叠为聚合 dot
- 焦点跟随 active，越界时重新渲染
- Wheel 刷卡浏览（鱼眼模式下拦截 wheel 事件）
- 状态：`focusStart`、`focusEnd`、`fisheyeMode`、`scrubFocusIndex`
- 事件：`onTimelineWheel`（已在 destroy 中移除）

**v1.5.0**：API 数据层
- Claude API `chat_messages` 作为完整消息数据源
- current leaf 父链构建当前分支
- UUID marker 与 React Fiber DOM 映射

**v1.5.1**：虚拟列表回归修复
- 自动触发 `Load earlier messages`
- 未挂载 UUID 分段滚动、等待挂载并再次精确匹配
- Fiber 限定为组件直接 `message.uuid`，禁止递归共享状态
- `branchOrder` + 真实 DOM 锚点生成空间布局
- `positionLayout` 锁定坐标，首尾固定为 0%/100%，滚动漂移为 0px
- 增加 API、marker、DOM 映射和点击诊断输出

---

## 📋 待开发任务

**当前无待开发任务**

如需新增功能，请：
1. 先在此文档添加任务描述
2. 实现后移至"已完成"区
3. 更新 `manifest.json` 版本号
4. 更新 `DEV_FIX_LOG.md` 架构说明

---

## ❌ 明确不做

1. 时间轴内部虚拟滚动窗口（有自己滚动条）
2. 复杂展开面板/多级状态机
3. 替换 hash 算法
4. 与 API 数据层无关的跨文件大重构
5. 用文本或 `data-testid` 代替 UUID 识别消息
6. 在滚动时重新计算并移动已渲染 dot
