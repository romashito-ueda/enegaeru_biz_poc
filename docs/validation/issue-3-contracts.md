# Issue #3 検証記録

2026-09-15、Windows / Node 24.14.1 / Python 3.12。PRの比較元はIssue #2の `codex/issue-2-bootstrap`。

- JavaScript: 40テスト成功。共通26ケース、入力hash、変換の区間/月/年保存則、旧Params全項目の移行、質問ケース、結果契約と既存9テスト。
- Python: 6テスト成功。共通26ケースを同じJSONから読み込み、JSが出した4件の完全入力hashと一致。非有限数・整数の1.0表記も検証。
- `npm run typecheck` 成功。enum/単位/系統充電の型が広いstring/booleanへ崩れないコンパイル検証を含む。
- `npm run contracts:check` と `npm run fixtures:check` 成功。生成物の再現性を確認。
- `npm run build` 成功。既存の大きなチャンク/ルート静的分類の警告は継続。
- Windows/Ubuntu CIにPython・共通スキーマ・fixture検証を追加。

計算精度・実データ妥当性を証明するテストではない。物理計算はT03〜T05、HTTP接続はT02、既存画面/localStorageの読替えはT06で実施する。旧CSVの設備・一括費用の内訳等は復元不能なため、元データを保存して確認対象として明示する。
