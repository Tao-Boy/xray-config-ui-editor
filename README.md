# 🚀 Xray 配置编辑器（简体中文版）

[简体中文](README.md) · [English](README.en.md)

用于 **Xray-core** 的静态网页配置编辑器。通过图形界面管理配置、查看流量拓扑，并直接与 **Remnawave 面板**同步。无需后端，编辑器在浏览器中运行。

此仓库是 [bropines/xray-config-ui-editor](https://github.com/bropines/xray-config-ui-editor) 的中文本地化 fork。首次打开默认使用简体中文，也可从顶部语言菜单切换 English 或 Русский；手动选择的语言会保存在当前浏览器中。

<img width="1914" height="981" alt="上游项目界面示例，截图中的语言为英文" src="https://github.com/user-attachments/assets/11c13d94-58d9-421f-af34-0f317e6ae086" />

> 上图及下方截图来自上游项目，展示功能布局。此 fork 的实际界面支持简体中文。

> [!IMPORTANT]
> ### 🤝 欢迎参与
> 上游项目采用 AI 辅助开发。开发约定见 [`agents.md`](agents.md) 和 [`.agents/AGENTS.md`](.agents/AGENTS.md)。欢迎改进功能、修复问题或完善翻译并提交 PR。
>
> 💬 **上游 Telegram 频道**：[xcue_dev](https://t.me/xcue_dev)

## ✨ 功能

- 🛠 **完整配置管理**：入站、出站、路由、DNS、策略、日志、统计及 API。
- ☁️ **Remnawave 集成**：通过 API 令牌连接面板，读取和保存配置、主机、订阅模板及配置片段。
- 🕸 **可视化拓扑**：基于 React Flow 展示流量路径、路由规则与负载均衡节点。
- 🛡 **REALITY 工具**：内置 X25519 密钥对和短 ID 生成器。
- 📝 **双模式编辑**：在图形表单与 [CodeMirror 6](https://codemirror.net/) JSON 编辑器之间切换，支持 JSONC 注释、语法检查、补全及搜索替换。
- 📂 **本地管理**：拖入 `config.json`、使用内置预设、保存多份配置，或备份整个工作区。
- 🧩 **路由管理**：拖动规则排序，编辑匹配条件和负载均衡策略。
- ⚖️ **本地负载均衡构建器**：从代理链接、订阅、当前配置或面板主机生成客户端配置，包含本地 SOCKS/HTTP 入站、代理节点池、健康探测与绕过列表；也可按地区分组生成配置。
- 📡 **主机编辑器**：编辑 Remnawave 主机地址、传输参数、关联入站与模板，保存时仅发送修改过的字段。
- 📄 **订阅模板**：在负载均衡构建器内通过表单或 JSON 编辑 `XRAY_JSON` 模板，使用 `remnawave.injectHosts` 为每个订阅用户注入节点。
- 🧷 **配置片段与本地模板**：识别并管理 `{ "snippet": "NAME" }` 引用，支持插入引用或独立副本。
- 🌐 **简体中文、英文与俄文**：界面、工具提示、诊断、校验错误、操作通知和编辑器内置控件支持本地化。Xray 配置字段、协议名称、枚举值、密钥及示例地址保留原始形式，保证配置兼容性。
- 😇 **操作说明**：主要字段和功能附带用途及兼容性提示。

## 🚀 使用

1. 打开编辑器，拖入 `config.json`，或选择预设创建配置。
2. 在图形界面中编辑入站、出站、路由和 DNS；需要直接修改字段时切换到 JSON 模式。
3. 在内核设置中选择目标 Xray-core 版本，打开“系统诊断”检查兼容性。
4. 下载配置到本地，或连接 Remnawave 后保存到云端配置。

编辑器会在浏览器本地保存工作区。“备份与恢复”可导出配置、历史、片段库和设置。安装为应用前，特别是在 iOS 上，请先导出备份，再在安装后的应用中导入。

## 🧱 已知限制

Xray 的某些参数组合仍可能存在冲突。如果遇到编辑器未识别的兼容性问题，请通过 [Issues](https://github.com/Tao-Boy/xray-config-ui-editor/issues) 提供可复现的配置示例，并移除账号、令牌和私钥。

负载均衡器内置的“俄罗斯网站直连”列表针对俄罗斯站点；它是可选预设，中文本地化不会改变其域名内容。可按需求选择列表或添加自定义绕过域名。

## 📸 功能示例

以下为上游项目截图。

### Remnawave 云端同步

<img width="413" height="455" alt="连接 Remnawave 面板并管理云端配置" src="https://github.com/user-attachments/assets/3374f6b7-8605-47f5-bd0e-3bba4e9eeb96" />

### 路由管理

<img width="1113" height="859" alt="通过拖动排序管理路由规则" src="https://github.com/user-attachments/assets/00386afe-d97d-42a2-ae56-cad40ec4e66a" />

### 流量拓扑

<img width="1112" height="808" alt="可视化查看流量经过内核的路径" src="https://github.com/user-attachments/assets/be7c017b-e0e7-4ed4-b6e3-125e8929b512" />

### 地理数据查看器

<img width="1032" height="927" alt="通过链接或本地文件查看 GeoIP 与 GeoSite 数据" src="https://github.com/user-attachments/assets/863b26f8-b97a-44b4-9866-3e80ec0a51eb" />

### 入站与出站编辑

<img width="1105" height="795" alt="入站配置表单" src="https://github.com/user-attachments/assets/5ddcb432-f024-4038-8019-cad466823550" />

<img width="1101" height="791" alt="出站配置表单及 AmneziaWG 导入" src="https://github.com/user-attachments/assets/50170d6b-dd8c-45e2-b1cd-cbffd20b62f4" />

### JSON 编辑

<img width="1914" height="981" alt="JSON 配置编辑器" src="https://github.com/user-attachments/assets/b0c559a7-375f-4965-a44e-0141078dd1ff" />

图形界面未提供的字段可直接在 JSON 中编辑。编辑器会保留未知配置字段。

## ☁️ 连接 Remnawave（CORS 配置）

这是静态网页应用。浏览器访问 Remnawave 服务时，需要在面板反向代理中配置 **CORS**。

以下示例用于从 `https://tao-boy.github.io` 访问面板。如果使用自定义域名或本地开发地址，请将两处 `Access-Control-Allow-Origin` 替换为实际编辑器页面的来源（协议、主机名及端口，不包含路径）。示例不表示此 fork 已部署到 GitHub Pages。

将以下内容加入 Nginx 配置的 `location /`：

```nginx
# 隐藏后端可能重复返回的响应头
proxy_hide_header 'Access-Control-Allow-Origin';
proxy_hide_header 'Access-Control-Allow-Methods';
proxy_hide_header 'Access-Control-Allow-Headers';

# 允许编辑器页面的来源
add_header 'Access-Control-Allow-Origin' 'https://tao-boy.github.io' always;

# PATCH 用于保存修改
add_header 'Access-Control-Allow-Methods' 'GET, POST, PATCH, DELETE, OPTIONS' always;
add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type, Cache-Control, X-Requested-With' always;

# 处理 OPTIONS 预检请求
if ($request_method = 'OPTIONS') {
    add_header 'Access-Control-Allow-Origin' 'https://tao-boy.github.io' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PATCH, DELETE, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type, Cache-Control, X-Requested-With' always;
    add_header 'Access-Control-Max-Age' 1728000;
    add_header 'Content-Type' 'text/plain; charset=utf-8';
    add_header 'Content-Length' 0;
    return 204;
}
```

检查并重新加载 Nginx：

```bash
nginx -t
nginx -s reload
```

API 令牌权限说明可从连接窗口查看。编辑器需要的资源包括配置文件、主机、订阅模板和配置片段。

## 🛠 安装与开发

技术栈：**React、TypeScript、Zustand、Vite、Tailwind CSS 和 Bun**。

```bash
# 安装依赖
bun install

# 启动开发服务器
bun run dev

# 生产构建，生成 dist/
bun run build

# 本地预览构建结果
bun run preview
```

默认开发端口为 `3000`，页面路径为 `/xray-config-ui-editor/`。部署到其他路径时，请同步修改 `vite.config.ts` 的 `base`。

### 发布到 GitHub Pages

1. 打开仓库 **Settings → Pages**，在 **Build and deployment → Source** 中选择 **GitHub Actions**。首次启用 Pages 需要仓库管理员完成此设置。
2. 如果 fork 的 **Actions** 尚未启用，先在 Actions 页面启用工作流。
3. 推送到 `main` 后，`Deploy to GitHub Pages & Release` 工作流会自动运行测试、类型检查、代码检查、翻译检查和生产构建，然后发布网站。
4. 也可在 **Actions → Deploy to GitHub Pages & Release → Run workflow** 中选择 `main` 手动部署。推送 `v*` 版本标签仍会部署并创建 GitHub Release。

部署成功后，访问 [简体中文版网站](https://tao-boy.github.io/xray-config-ui-editor/)。Pages 使用 `github-pages` 部署环境，Actions 的部署记录会显示网站地址。

### 翻译维护

界面通过 `src/i18n` 的 `t()` 查找译文，使用英文原文作为键；`tn()` 处理数量表达。词典位于：

- 简体中文：[`src/i18n/zh-CN.ts`](src/i18n/zh-CN.ts)
- 俄文：[`src/i18n/ru.ts`](src/i18n/ru.ts)
- 保留的协议名、枚举及示例：[`src/i18n/untranslated.ts`](src/i18n/untranslated.ts)

新增文案需接入翻译函数并补齐词典。中文可覆盖保留名单中的显示标签，但不会改变写入配置的值。CodeMirror 内置文案位于 `src/components/ui/code-mirror-phrases.ts`；Zod 的校验语言会随界面切换。

```bash
# 查看各语言的缺失、过期词条与保留项
bun run i18n:report

# 修改后的完整检查
bun run typecheck
bun run lint
bun test
bun run build
```

翻译测试会检查覆盖率、变量占位符，以及中文默认语言、切换、数量显示、校验与预设选择。

## 🤝 致谢

- **原项目作者 bropines 及贡献者**：编辑器及各项功能。
- **Xray-core**：配置所对应的代理内核。
- **Remnawave**：代理管理面板。
- **Phosphor Icons**：图标。
- **xyflow / React Flow**：流量拓扑。
- **CodeMirror**：浏览器代码编辑器。

## ⚠️ 免责声明

本工具用于学习与配置管理。使用代理软件时请遵守当地法律法规。

为隐私社区而构建 ❤️
