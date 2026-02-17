# 项目结构

## 根目录文件

### 扩展核心
- `manifest.json` - 扩展配置（权限、内容脚本、版本）
- `content.js` - 注入到 Claude.ai 页面的主要时间轴逻辑
- `styles.css` - 时间轴 UI 样式，支持主题适配
- `popup.html` - 扩展弹窗界面
- `popup.js` - 弹窗设置逻辑
- `popup.css` - 弹窗样式

### 文档
- `README.md` - 用户文档（中文）
- `LICENSE` - MIT 许可证
- `DEV_FIX_LOG.md` - 开发修复日志
- `OPTIMIZATION_TODO.md` - 优化任务列表

### 配置
- `.gitignore` - Git 忽略规则
- `.vscode/` - VS Code 工作区设置
- `.kiro/` - Kiro AI 助手配置

## 开发资源

### DOM分析脚本及数据/
开发过程中使用的调试和分析脚本：
- `claude-dom-*.js` - DOM 检查工具
- `*.json` - 捕获的 DOM 分析数据
- 用于调试 Claude.ai 页面结构变化

## 架构模式

### Content Script (content.js)
- 单类架构：`TimelineManager`
- 生命周期：`init()` → `findCriticalElements()` → `injectTimelineUI()` → `setupObservers()`
- 主要职责：
  - DOM 元素检测（`USER_MESSAGE_SELECTOR`）
  - 时间轴渲染（简单模式 vs 鱼眼模式）
  - 事件处理（点击、长按、悬停、滚动）
  - 状态持久化（通过 localStorage 保存收藏消息）
  - 容器验证和观察器重新绑定

### 状态管理
- Markers 数组：表示用户消息及其位置数据
- 收藏消息：按对话 ID 存储在 localStorage 中
- 活跃消息追踪：通过 IntersectionObserver 与滚动位置同步

### 渲染模式
- **简单模式**：所有消息显示为独立节点（空间充足时）
- **鱼眼模式**：焦点区域展开，远处消息聚合（用于长对话）

## 代码规范

- 使用 ES6+ 特性（箭头函数、const/let、模板字符串）
- 优先使用 `querySelector` 而非 `getElementById`
- 使用 `requestAnimationFrame` 进行视觉更新
- 对昂贵操作进行防抖处理（重新计算、渲染）
- 容器变化时清理观察器，防止内存泄漏
