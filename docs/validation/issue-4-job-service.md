# Issue #4 検証記録

2026-09-15、Windows / Node 24.14.1 / Python 3.12。比較元はマージ済みIssue #2・#3を含むmain。

## 実装範囲

ローカルFastAPI、spawn方式の単一計算プロセス、上限付きの待ち行列とメモリキャッシュ、作成/進捗/キャンセルAPI、TypeScriptクライアント、Vite開発プロキシを実装。ジョブ投入後の編集は受付済みの入力/対象範囲へ影響しない。同一入力の20と20.0等の数値表記差でも重複実行を発生させない。

現時点のworkerは入力検証専用。結果に `validation_only` と未計算項目を明示し、物理計算モードへの要求はENGINE_UNAVAILABLEを返す。PySAM・numpy-financialは独立環境に固定版で導入済み。発電・電池・投資計算は後続Issueで接続する。

## 確認結果

- `npm test`: **43件成功**。既存の計算/Excel/共通契約と、HTTPクライアントの応答検証・エラー・中断を含む。
- クリーンなvenvへ `services/engine/requirements.txt` だけで導入し、`python -m pip check`: **成功**。過去の `work/engine-packages` を使用していない。
- 同venvで `python -m unittest discover -s services/engine/tests -v`: **16件成功**。共通契約6件＋実行基盤10件。実プロセスによる進捗・重複・上限・キャンセル・入力の固定・再試行・時間超過・異常終了・結果サイズ・キャッシュ期限・再起動を確認。
- `npm run typecheck` / `npm run contracts:check` / `npm run fixtures:check`: **成功**。
- `npm run build`: **成功**。既存の大きなチャンクとルート静的分類に関する警告は継続。
- 起動した開発UI `http://localhost:3100/` へのGET: **200**。
- 同UIの `/engine/health`: **200 / ok**。TypeScriptクライアントから同プロキシ経由で工場fixtureを送信し、**succeeded / validation_only / 17,520区間**を確認。同じ要求を再送すると同じジョブIDを再利用。

サービスの上限・メモリ保存・再起動時の消失・起動手順は `services/engine/README.md`、ライセンス表示は `THIRD_PARTY_NOTICES.md` に記載。既存画面の計算切替はIssue #8で扱う。実データ精度や本番ホスティングの検証は今回の範囲外。
