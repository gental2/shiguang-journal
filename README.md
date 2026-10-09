# 拾光 · 学习与人生手账

独立网站：https://gental2.github.io/shiguang-journal/

记录学习感悟、人生清单与完成心得，支持五种柔和配色、完成统计、人生清单 PNG 长图、JSON 导入导出、搜索、草稿和深色主题。

## 保存与同步

- 未登录：使用浏览器本地存储。登录后点击「我的账号 → 导入此浏览器旧记录」，明确导入；原有本机记录保留。
- 已登录：感悟与人生事项使用独立 Supabase 项目 `shiguang-journal`，每个账号只可访问自己的数据。登录同一账号即可跨设备读取。
- 只有「已同步到云端」表示上传成功。离线时先保存本机缓存，恢复网络、打开页面或手动同步时重试。
- 缓存按项目和用户 ID 隔离。清除浏览器数据前，请确认同步成功并导出备份。
- 不同记录的新增、删除和修改可自动合并。同一记录出现不一致修改时明确选择；过期编辑表单不会覆盖新内容。
- 数据通过版本比较和数据库事务提交。最近 50 次变更前的快照可从账号中下载；草稿、配色和长图标题保存在设备上。
- 网站代码部署不会清空数据库。后续数据格式升级须提供兼容迁移，不能删除旧表或改用空数据库覆盖记录。

GitHub 中只含代码与公开的 Supabase publishable key，**不含用户手账、数据库密码、secret/service_role key**。数据库访问由 Supabase Auth + Row Level Security 控制。不要将任何私密密钥放在静态网页中。

## Supabase 配置

数据库迁移：`supabase/migrations/20261009000000_journal_cloud.sql`（已经在独立项目上应用）。

Authentication → URL Configuration:
- Site URL: `https://gental2.github.io/shiguang-journal/`
- Redirect URLs 添加上述同一个完整地址。

邮箱密码登录需要先注册并验证邮箱。网站会保留待验证提示；邮件请求显示冷却倒计时，请求处理中禁止重复提交。发送额度耗尽时会提示检查已有验证邮件，登录不受邮件冷却影响。Supabase 默认邮件服务限制较多，建议项目所有者先使用其 Supabase 账号的邮箱；更广泛使用须配置自己的 SMTP。Free 项目仍受服务方配额、可用性和暂停政策影响；保留导出备份。

## 运行与测试

这是独立静态站点，不依赖演讲项目或 Vite，Node.js 24 用于测试。

```sh
npm test
python -m http.server 8080
```

GitHub Actions 执行数据与同步单元测试、真实 Chromium 界面测试，然后发布 GitHub Pages。浏览器测试用模拟登录/传输验证跨设备交互，并对真实 Supabase 做匿名拒绝检查；真实账号邮件验证与登录需由本人完成。数据库另执行了回滚式临时账号测试，验证本人写入、跨账号隔离、匿名禁止、版本冲突和历史记录，测试结束不保留测试用户。

GitHub Settings → Pages → Source 选择 **GitHub Actions**。

## 部署范围

本仓库是手账的全部前端与部署配置。Supabase 项目独立。不会修改 `one-minute-speech-challenge` 演讲项目。

旧网址和新网址属于同一个 `gental2.github.io` 域名，浏览器原有手账记录仍可在新网站的「导入此浏览器旧记录」中读取。若换了设备，请在旧设备导出 JSON，再导入新账号。
