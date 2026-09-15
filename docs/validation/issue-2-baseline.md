# Issue #2 初期取込みの検証記録

対象: [Issue #2](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/2)。既存のTRACE PoC（基準コミット`98223fe`）と、計算監査・パッケージ評価・実装計画を再現できる開始点として取り込む。

## 環境と検証

Node.js 24.14.1 / npm 11.11.0 / Windows 11。2026-09-15に、別ディレクトリへソースだけをコピーし、既存のnode_modulesを共有せず`npm ci`から検証した。

| 項目 | 状態 |
| --- | --- |
| ソースだけの状態から`npm ci` | 成功、651パッケージを導入 |
| `npm test`（既存9件） | 9件成功。17,520区間・5シートのXLSX往復を含む |
| `npm run typecheck` | 成功 |
| `npm run build` | 成功、client/RSC/SSRを生成 |
| 開発サーバーのHTTP応答 | `npm run dev -- --port 3100`で起動し、GET / がHTTP 200（80,708 bytes） |
| 合成入力による監査6論点の再現 | F1〜F6をすべて再現 |

GitHub ActionsにはUbuntu/Windowsの検証を定義する。CIの実行状態はPRのChecksを正とする。Pythonスモークの過去の測定値は`research/engine-evaluation/results.json`に保存され、実環境の予測精度を保証するものではない。

ビルドには既存の500kB超チャンクとVinextのルート分類に関する通知が残る。今回の検証はビルド成功と起動の確認であり、バンドル最適化やブラウザ操作試験ではない。`package-lock.json`と製品コードの計算式は変更していない。

## 未修正事項と引継ぎ先

| 監査論点 | 今回の扱い | 後続 |
| --- | --- | --- |
| F1 契約電力の月次履歴 | 検討対象外。既存デモには残る | 新評価経路では効果に含めない |
| F2 夜間の充放電分岐 | 未修正 | [#6](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/6)で新しい自家消費運転へ置換 |
| F3 年次の物理運転・収支 | 未修正 | [#5](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/5)、[#6](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/6)、[#7](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/7) |
| F4 方位・傾斜の物理モデル | 未修正 | [#5](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/5)でPySAMへ置換 |
| F5 電池追加価値の売電機会費用 | 未修正 | [#7](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/7) |
| F6 発電実績と設備条件の不一致 | 未修正 | [#3](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/3)、[#8](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/8) |

既存テストの成功は、これらの不具合がないことを意味しない。`research/calculation-audit.mjs`は不具合を再現する調査スクリプトであり、その差異を維持する回帰テストにはしない。

PySAMの未検証範囲はPV長期劣化とPCS制限、詳細PVと電池の長期統合、夜間充電/ピーク制御、Cashloan/Utilityrate5の日本向け対応、実測精度、並列実行時の性能。これらを既存スモークの成功から推定しない。
