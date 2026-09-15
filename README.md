# TRACE — 産業用エネルギー設計 PoC

エネがえるBizの公開機能を調査し、太陽光・蓄電池導入の操作と意思決定を検証するPoCです。データ調達の実現性調査は対象外。公開資料に基づく調査で、競合製品へのログイン・実機評価はしていません。

## 実行

Node.js 24.14.1（`.nvmrc`）、npm 11。依存関係は`package-lock.json`で固定しています。

```sh
npm ci
npm run dev
```

画面内のサンプル案件から、条件調整、案比較、名前付き保存、需要編集、提案書出力を試せます。保存先はブラウザのlocalStorage。JSONでバックアップ／追加読込できます。

## 構成

- `lib/simulation.ts`: 30分×365日の需要・発電・蓄電運転、料金と20年キャッシュフロー
- `components/workspace.tsx`: 案件、条件保存、3案比較、CSV取込、提案書
- `components/conditions.tsx`: 基本条件・詳細パネル
- `components/energy-charts.tsx`: 日次平均、残量、長期収支、月別テーブル
- `lib/exports.ts`: CSV・5シートのExcel出力。ExcelJSは出力時に読み込む
- `public/feature-inventory.md`: 出典付き機能対応表とUXの検証計画

## 確認

```sh
npm test
npm run typecheck
npm run build
```

計算テストでは電力収支、残量・出力制約、太陽光と系統由来の分別、年／月総量、PCS制限、料金、収支、CSVエラーを確認します。ブラウザの操作テスト・実利用者による競合比較は未実施です。

GitHub ActionsでもPRごとに、依存関係のクリーンインストール、テスト、型検査、ビルドを実行します。検証基準と未修正事項は[初期取込みの検証記録](docs/validation/issue-2-baseline.md)を参照してください。

## Pythonの計算検証

現在のUIはNode.jsだけで動きます。PySAMの研究スモークにはPython 3.12を別途用意します。次の例はWindows PowerShell用です。環境のactivateは不要です。

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r research/engine-evaluation/requirements.txt
.venv\Scripts\python.exe research/engine-evaluation/smoke.py
```

macOS/Linuxでは実行ファイルを`.venv/bin/python`に置き換えてください。スモークは合成気象で動き、外部APIキーは不要です。`research/engine-evaluation/results.json`は実行時に更新されるため、保存された検証記録を残したい場合は別checkoutで実行します。`work/engine-packages`は過去の評価用の任意配置で、実行に必須ではありません。

Pythonの常駐APIは後続の[Issue #4](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/4)で`services/engine/`へ追加します。React/VinextとPythonは別プロセスです。

## 開発とPR

Issueごとに`codex/issue-番号-説明`ブランチと個別のPRを作ります。依存先が未マージなら、そのブランチを比較元にした積み重ねPRにし、依存関係を本文へ記載します。

`.openai/hosting.json`は既存Sitesプロジェクトの識別情報と空のストレージ設定です。既存のVite/Sites構成を維持しており、`npm run build`はローカル成果物の生成だけを行います。デプロイ処理や認証情報の配布はこのPoCの初期取込みに含めません。ブラウザ内の案件はlocalStorageに保存されます。

2026年9月8日の[計算ロジック調査](research/calculation-logic-audit.md)では、公開仕様との照合と合成入力によって6論点の差異を再現しました。既存テストの成功は、料金制度や長期運転モデルとの一致を保証するものではありません。診断は `node research/calculation-audit.mjs` で再実行できます。

続く[計算パッケージ検討](research/calculation-package-assessment.md)では、契約電力を対象から外し、PySAMを中心とする計算の分離を推奨しています。`research/engine-evaluation`に30分のPV・20年の電池運転等を実行した再現スクリプトと結果があります。アプリ本体への組み込みは未実施です。

## 実装計画

2026年9月15日の[実装計画](docs/plans/2026-09-15-implementation-plan.md)に、PySAMへの計算分離、住所からの案件作成、顧客条件からの設備案探索、次の確認項目の選択をまとめています。[親Issue本文](docs/issues/2026-09-15/E01.md)からPoC本体12件と後続2件の本文・依存関係・完了条件を確認できます。[GitHubの全体計画 #1](https://github.com/romashito-ueda/enegaeru_biz_poc/issues/1)に15件のIssueを公開済みです。登録番号と本文の記録は[manifest](docs/issues/2026-09-15/manifest.json)にあります。

## 制約

商用の計算精度・実データ接続・共同編集は未実装。6面の屋根、自由な充放電時間帯、祝日ルール、詳細料金制度、設備別経年劣化、最適容量探索等は後続。実データの接続に加え、契約電力・充放電分岐・経年計算・発電CSVと設備条件の対応の改修が必要です。詳細は計算ロジック調査を参照してください。

WebMCP対応ブラウザでは、現在の案を読む `read_energy_scenario` と設備容量を変更する `configure_energy_scenario` を登録します。この環境では対応ブラウザでのWebMCP契約検証は未実施です。非対応ブラウザの通常操作には影響しません。
