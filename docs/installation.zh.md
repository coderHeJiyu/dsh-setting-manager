# 安装指南 — dsh-setting-manager

> 本文是 [README 安装节](../README.md)的展开版，覆盖前提、安装、验证、
> 更新、卸载五个环节。
> English: [installation.en.md](./installation.en.md)

## 前提

1. **DSH（DeepSeek Harness）已安装**，且 `web` profile 已初始化（插件装到该
   profile，即 `--profile web`）。
2. **Node.js ≥ 22**（插件包 `engines` 声明 `node >= 22`）。
3. **pnpm**。`dsh plugin` 经由 pnpm 管理插件，必须已安装；本包是纯 JS、
   无构建步骤，源码安装不需要额外的装依赖或构建命令。

## 安装

### 方式一：GitHub 直接安装（推荐）

```powershell
dsh plugin --profile web add github:coderHeJiyu/dsh-setting-manager
```

从 GitHub 仓库直接安装，拉取默认分支的 HEAD。插件是纯 JS、不带 `prepare`
构建脚本，pnpm ≥10 无需 `allowBuilds` 放行。

### 方式二：源码安装（试用 / 开发）

适合从源码试用或在开发中直接挂载。克隆仓库后从根目录安装：

```powershell
git clone https://github.com/coderHeJiyu/dsh-setting-manager.git
cd dsh-setting-manager
dsh plugin --profile web add .
```

纯 JS 包，`lib/` 即源码，不需要 `pnpm install` / 构建；最后一条 `add .`
在仓库根目录执行，安装当前目录。本地开发也可以用 `link:` 软链安装
（client 端改动热更，见 README 项目结构一节）：

```powershell
dsh plugin --profile web add link:/path/to/checkout
```

## 验证

```powershell
dsh plugin --profile web list
dsh web --dump-config | Select-String setting-manager
```

逐项核对：

1. `dsh plugin --profile web list` 的输出中出现 `dsh-setting-manager`，说明
   插件已注册进 web profile；
2. `dsh web --dump-config | Select-String setting-manager` 命中插件的 profile
   bundle 行（`cordis.patch.yml` 插入的 `setting-manager` 条目）；
3. **重启 DSH Web GUI**（重新 `dsh web`）。Host 端 route 与 client 入口都在
   启动时加载；
4. 打开设置页，在左侧分区导航上右键，弹出「设置菜单」勾选菜单；
5. 点一个分区切换显隐：对应分区从导航消失，`$DSH_HOME/dsh-setting-manager.json`
   生成（默认 `~/.dsh/dsh-setting-manager.json`）；刷新页面、换浏览器，
   状态不变。

## 更新

- **GitHub 安装**：重跑安装命令，重新解析到默认分支的最新提交：

  ```powershell
  dsh plugin --profile web add github:coderHeJiyu/dsh-setting-manager
  ```

- **源码安装**：更新仓库内容（如 `git pull`）。`add .` 拷贝安装则在仓库
  根目录重新执行：

  ```powershell
  dsh plugin --profile web add .
  ```

  `link:` 软链安装无需重装，重启后 Host 端生效（client 端热更）。

- 更新后重启 GUI 生效。
- 状态文件 `$DSH_HOME/dsh-setting-manager.json` 独立于插件版本，更新不会
  删除或覆盖它。

## 卸载

```powershell
dsh plugin --profile web remove dsh-setting-manager
```

卸载后：

- 右键勾选菜单与 `/api/setting-manager` route 消失；
- 状态文件不会自动删除；需要时可先备份，再手动删除（多个 profile 安装本插件
  时共享同一份状态文件，删除会同时影响它们）。

## 相关文档

- [README（中文）](../README.md) · [README (English)](./README.en.md)
