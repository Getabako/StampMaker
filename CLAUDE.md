@AGENTS.md

## Claude Code 向けの補足

- 画像生成・企画・点検はすべて codex CLI（サブスク）。`codex exec -i <参照画像> --sandbox workspace-write --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check "<指示>"`。有料画像 API は PreToolUse フックが自動でブロックする
- 長い生成は `nohup node bin/cli.js run <brief.json> > .ashura/run.log 2>&1 &` で常駐させ、`project.json` の status を見て終了を待つ
- 秘書モード（タスク報告・knowledge-base 参照）はこのフォルダでは発動しない（配布ツールのため）
- 生成物は `~/StampMaker-data/sets/<id>/`。リポジトリには入れない
- 直したら `node --check` のみ（ビルド不要）。サイト登録（arts/page.tsx 等）は CodexAppServer のメモリ「codexappserver-arts-command-rule」の手順
