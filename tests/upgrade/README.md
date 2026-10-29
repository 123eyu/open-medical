# 升级兼容测试（T11b）

`upgrade.test.mjs` 用当前分支的 `createServer` 打开一份由 `main` 生成的旧数据库，验证：

- 旧患者的摘要/详情、今日待办、随访、检查转诊、病例库、待确认提案、医生档案和医生记忆在升级后数据一致；
- 插件迁移已记录到 `plugin_migrations`；
- `sqlite_master` 中旧表全部存在，旧列的定义和顺序不变（只允许新增表、在表尾新增列）；
- 未连接渠道时 followup 进入 dormant：插件业务接口返回 409 `FOLLOWUP_INACTIVE`，待办不再出现 followup/messages，但旧行仍留在表中；固定区提醒总线 `/api/reminders` 按 T7.6 的既有约定保持可读。

## Fixture

- `fixtures/legacy.sqlite`：由 `main`（T11b 开始时为 `f128fe4`）创建、已 `VACUUM` 的旧数据库。只包含内置示例患者和被测试创建出来的虚构记录。
- `fixtures/legacy-snapshot.json`：生成时抓取的接口快照。生成脚本会去掉随机 id、UUID、时间戳和会话/运行标识，把患者 id 替换为患者姓名；`doctor/overview` 的静态 `kinds` 目录是 T6 新增的界面元数据，不属于旧库数据，抓取时移除。

测试只读取 fixture 并复制到临时目录，不会修改 fixture。

## 重新生成

`make-legacy-db.mjs` 需要 `main` 版本的 `createServer`。不要在当前工作区分支切换，使用临时 worktree：

```bash
export GIT_CONFIG_COUNT=0
unset GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0
git worktree add .legacy-main main
ln -s ../../node_modules .legacy-main/node_modules

# 某些受限环境的 TMPDIR 是只读的；指定一个工作区内的临时目录。
mkdir -p .tmp
MEDICAL_TEST_TMP="$PWD/.tmp" node tests/upgrade/make-legacy-db.mjs --server-root .legacy-main

node --test --test-concurrency=1 tests/upgrade/upgrade.test.mjs

git worktree remove .legacy-main --force
rm -rf .tmp
```

脚本会重新创建示例资料，再通过真实接口制造以下数据：张沪生的一条检验（档案修改提案已确认）、一个已确认的随访计划、一个“检查转诊”类型的跟进事项、一个病例库条目、一条医生记忆、一份医生档案，以及李婉珍的一条仍待确认的档案修改提案。最后抓取快照、`VACUUM` 数据库并写入 `fixtures/`。

生成后请用 `git status` 确认只应出现 `legacy.sqlite` 和 `legacy-snapshot.json` 两个 fixture 变更；`.sqlite-wal` / `.sqlite-shm` 不应提交。
