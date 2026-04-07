# 短剧盗版检测工具 — MVP Implementation Plan

## 概述

构建一个本地运行的 Next.js Web 应用，使用 Playwright 自动化后台查询和 Google 搜索，SQLite 存储数据，SheetJS 导出 Excel。

---

## Proposed Changes

### 项目初始化

#### [NEW] 项目根目录

- 使用 `npx create-next-app@latest ./` 初始化 Next.js 项目（App Router, JavaScript, 无 Tailwind）
- 安装额外依赖：`playwright`, `better-sqlite3`, `xlsx`

---

### 数据库层

#### [NEW] [db.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/lib/db.js)

SQLite 数据库初始化与操作封装。

**Schema 设计：**

```sql
-- 检测任务
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now', 'localtime')),
  status TEXT DEFAULT 'pending',  -- pending / running / paused / completed
  total_dramas INTEGER DEFAULT 0,
  completed_dramas INTEGER DEFAULT 0,
  operator_name TEXT DEFAULT ''
);

-- 短剧信息
CREATE TABLE dramas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id),
  drama_id TEXT NOT NULL,          -- 后台系统ID
  input_name TEXT,                 -- 用户粘贴时的原始名称
  name TEXT,                       -- 后台查询的英文名
  chinese_name TEXT,               -- 中文名
  cp_name TEXT,                    -- CP名称
  is_self_made BOOLEAN,            -- 自制=true, 引入=false
  content_type TEXT,               -- '国内翻译' / '海外原创' / null
  status TEXT DEFAULT 'pending',   -- pending / querying / searching / completed / skipped / error
  error_message TEXT
);

-- 搜索结果
CREATE TABLE search_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER REFERENCES dramas(id),
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  page_number INTEGER,
  is_pirated BOOLEAN DEFAULT NULL,  -- null=未标记, true=盗版, false=非盗版
  domain TEXT                       -- 从URL提取的域名
);
```

**封装函数：**
- `createTask(dramaList)` — 创建任务并批量插入短剧
- `getDrama(id)` / `updateDrama(id, data)` — 短剧 CRUD
- `addSearchResults(dramaId, results[])` — 批量插入搜索结果
- `markPirated(resultId, isPirated)` — 标记盗版
- `getTaskWithDramas(taskId)` — 获取任务及其短剧信息
- `getSearchResults(dramaId)` — 获取搜索结果
- `getPiratedResults(taskId)` — 获取所有已标记盗版的结果（用于导出）

---

### Playwright 自动化层

#### [NEW] [automation/backend-query.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/lib/automation/backend-query.js)

后台系统查询自动化。

**流程：**
1. 连接已打开的浏览器（用户已登录）或启动新浏览器实例
2. 导航到 `https://hwadmin.ikyuedu.com/glory-admin/content/`
3. 清空"短剧ID"搜索框 → 输入 ID → 点击"搜索"
4. 等待表格加载 → 提取：短剧名称、CP名称、自制引入
5. 若为自制 → 点击"编辑" → 点击"标记" tab → 提取国内翻译/海外原创
6. 返回提取的数据

**关键实现细节：**
- 使用 `playwright.chromium.launchPersistentContext()` 复用浏览器 profile（保持登录态）
- 用户数据目录存放在项目内 `./browser-data/` 文件夹
- 提供登录检测 → 若未登录则暂停提示用户

#### [NEW] [automation/google-search.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/lib/automation/google-search.js)

Google 搜索自动化。

**流程：**
1. 在 Google 搜索框输入短剧英文名称
2. 抓取当前页所有搜索结果（标题、URL、摘要）
3. 点击"下一页"，重复直至 5 页或无更多结果
4. 每次翻页随机等待 5-15 秒

**反爬策略：**
- 随机延时（5-15 秒）
- 真实浏览器指纹（Playwright chromium persistent context）
- 验证码检测 → 暂停任务，发事件通知前端

#### [NEW] [automation/manager.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/lib/automation/manager.js)

任务执行管理器。

- 维护任务队列，逐条处理短剧
- 根据状态机驱动（pending → querying → searching → completed）
- 支持暂停/继续/取消
- 通过 SSE（Server-Sent Events）向前端推送进度更新

---

### 后端 API Routes

#### [NEW] [route.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/api/tasks/route.js)

- `POST /api/tasks` — 创建新任务（接收粘贴文本，解析 ID，入库）
- `GET /api/tasks` — 获取所有任务列表

#### [NEW] [route.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/api/tasks/[taskId]/route.js)

- `GET /api/tasks/:taskId` — 获取任务详情及短剧列表

#### [NEW] [route.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/api/tasks/[taskId]/start/route.js)

- `POST /api/tasks/:taskId/start` — 启动任务执行

#### [NEW] [route.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/api/tasks/[taskId]/progress/route.js)

- `GET /api/tasks/:taskId/progress` — SSE 进度流

#### [NEW] [route.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/api/dramas/[dramaId]/results/route.js)

- `GET /api/dramas/:dramaId/results` — 获取某短剧的搜索结果

#### [NEW] [route.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/api/results/[resultId]/mark/route.js)

- `PATCH /api/results/:resultId/mark` — 标记/取消盗版标记

#### [NEW] [route.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/api/tasks/[taskId]/export/route.js)

- `GET /api/tasks/:taskId/export` — 导出 Excel 文件

---

### 前端页面

#### [NEW] [page.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/page.js)

首页 — 新建任务。

- 大文本框用于粘贴短剧列表
- 解析预览（显示提取到的 ID 数量）
- "开始检测" 按钮

#### [NEW] [page.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/task/[taskId]/page.js)

任务详情页 — 进度 + 审核 + 导出整合。

- 顶部：进度条 + 状态统计 + 暂停/继续按钮
- 中间：短剧列表（含状态标签），点击某部短剧展开搜索结果
- 搜索结果卡片：标题 + URL + 摘要 + 标记按钮
- 底部：导出按钮（填写操作人姓名 → 下载 Excel）

> [!NOTE]
> 为简化 MVP，将进度、审核、导出合并在同一页面，减少页面跳转。用户可以在任务运行中开始审核已完成的短剧。

#### [NEW] [layout.js](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/layout.js)

全局布局 — 简洁的导航栏 + 页面容器。

#### [NEW] [globals.css](file:///Users/henryhsia/Library/CloudStorage/OneDrive-个人/fake%20detector/app/globals.css)

全局样式 — 暗色主题 + 现代设计系统。

---

## Verification Plan

### 浏览器测试

使用 `browser_subagent` 进行以下验证：

1. **首页功能**：打开 `http://localhost:3000`，在文本框中粘贴示例短剧列表，验证 ID 解析预览正确显示
2. **任务创建**：点击"开始检测"，验证跳转到任务详情页
3. **任务进度**：验证进度条和状态更新正常工作
4. **审核流程**：点击短剧 → 查看搜索结果 → 标记盗版 → 验证状态更新
5. **导出功能**：输入操作人姓名 → 点击导出 → 验证 Excel 文件下载

### 手动验证

由用户手动验证以下项目：
1. 后台系统浏览器自动化（需要真实登录态）
2. Google 搜索结果抓取（需要实际网络环境）
3. 导出的 Excel 格式与现有工作表格式一致
