# 計算契約 v1.0.0（Issue #3）

`contracts/schema.ts` がTypeScript型とJSON Schemaの唯一の定義元。`npm run contracts:generate` が `contracts/generated/` を生成する。JavaScriptはAjv、Pythonはjsonschemaで同じDraft 7を検証する。設備・時刻・来歴の整合性は両言語の `validateInput` / `validate_input` で検証する。HTTPとUIは後続Issueでこの入口を使う。

```powershell
npm run contracts:generate
npm run fixtures:generate
npm run contracts:check
npm run fixtures:check
npm test
.venv/Scripts/python.exe -m pip install -r services/engine/requirements.txt
.venv/Scripts/python.exe -m unittest discover -s services/engine/tests -v
```

Linux/macOSでは `.venv/bin/python` を使う。環境の作成はREADMEを参照。

## 時系列と設備

- 通常年の1月1日00:00〜翌年1月1日00:00直前、JST (`+09:00`) の区間開始時刻、30分×17,520。曖昧なローカル時刻、UTCとの混在、重複、欠損、うるう年は拒否する。
- load/absolute ACは区間電力量kWh。平均電力kWは `kWh / 0.5`、逆変換は `kW * 0.5`。日射DNI/DHIはW/m²。気象平均値の評価時刻（区間中央）はT03のアダプターが担当する。
- 1時間電力量は半分ずつ均等配分する。実測30分値の復元ではない。`originalResolutionMinutes: 60` と `transformation: "uniform_split_energy"` を来歴に記録する。時系列の来歴期間も時刻軸と一致させる。
- 方位は北0・東90・南180・西270。旧画面は南0、東負、西正なので `legacy + 180` に変換する。
- 絶対ACはPV容量、PCS、屋根版、面別の方位・傾斜・影損失・容量に紐づく。いずれかの変更や日射倍率の変更は拒否する。容量を変えるには気象入力へ切り替える。旧CSVを現在の設備へ自動で紐づけない。
- PV容量は許可屋根への配分合計と一致させる。容量ゼロではPCSもゼロ。電池はAC接続・自家消費制御・系統充電なし。

## 来歴と確認

数値・時系列は `{value, unit, provenance, uncertainty?}`。配列全体が来歴を共有する。

|軸|意味|
|---|---|
|kind|mock / assumed / derived / observed|
|acquisition|embedded / manual / imported / provider。取得経路|
|confirmation|unreviewed / desk_reviewed / site_verified。確認状態|
|source / period / updatedAt|由来、対象期間、更新日時|
|uncertainty|数値のmin/maxと根拠。確率・信頼区間ではない|

ユーザーがモック前提を確認してもkindはmockのままdesk_reviewedになる。site_verifiedはobservedに限定。値が未確定幅の外にある場合はエラー。確認状態から来歴を推測して変更しない。

## 投資と結果

自己所有・税前・借入なし・20年。契約電力/基本料金削減は除外。購入・売電単価は時系列で、燃調等は購入単価に含める。設備費はPV、PV PCS、電池、電池PCS、固定工事費を個別に保持。補助金・更新には年/対象/金額を指定し、電池更新には容量割合も必要。

予算は補助金控除前の初期費用。回収条件は非割引累積CFが以降20年目まで非負である「継続回収」。最初の黒字化とNPVは別。結果も単位と来歴を保持する。v1結果は年別集計の骨格で、電池由来別の詳細系列等はT04で追加する。

## 入力hash

TRACE canonical encoding v1をSHA-256にかける。全入力・来歴・時系列とモデル/料金/単価/前提/屋根の版を含む。キーはUTF-8順、数値はIEEE-754 binary64のビッグエンディアン16桁hexにし、-0を0へ正規化。文字列はUTF-8 JSON、型タグと区切り文字を付ける。Pythonの1.0とJSの1、指数表記の差でhashを変えない。非有限数は禁止。通常のJSON文字列を直接hashする方式とは異なる。

## 旧データ移行

`LEGACY_PARAM_MAPPING` はParamsの全項目を型で網羅し、`inspectLegacyProject` が移行プレビューを作る。Projectのid/name/location/profile/params/saved（保存日時を含む）と未知フィールドは `legacyArchive` に原形保存。プレビューは計算入力ではない。既存localStorageの読替えはT06。

|旧項目|対応・変換|
|---|---|
|pv / pcs / battery / power|PV DC/AC、電池kWh/kW|
|efficiency / reserve|往復効率 / 最低SOC、%をfractionへ|
|strategy / gridCharge|self / falseのみ初期対象。peak / trueからの変更は確認|
|target / contract / basic / tariffMode|対象外の制御・基本料金設定として保存|
|annual / monthly / demandData|MWhをkWhへ。CSVは期間/時刻/来歴を確認|
|profile / weekend / start / end|合成需要の設定として保存|
|rate / nightRate / fuel / levy / sell|購入単価成分と売電単価|
|yield|年間原単位から気象は復元不可。確認対象|
|orientation / tilt|南基準を北基準へ / 傾斜を保持|
|pvData|絶対ACとして設備紐づけを確認|
|solarCost / batteryCost|万円を円へ。一括費のPCS等への分解を確認|
|subsidy|万円を円へ。旧設備費上限での切り捨て、対象/時期を確認|
|maintenance / escalation / degradation / discount|%をfractionへ。劣化は金額ではなく物理入力へ|
|replacement|万円を円へ、旧12年目を保存。対象・容量割合を確認|
|co2|kgCO2/kWhを保持|

## Fixture作成方法

`fixtures/generated/` は `lib/domain/fixtures.ts` と生成スクリプトから再生成。乱数なし。工場120万/物流85万/小売180万kWhを年合計にし、営業時間・休日倍率・営業時間外20%の重みで配分、丸め差は最終区間に補正。日射は昼間正弦波、気温は季節正弦波、風速は2m/s。実在物件や地域の観測データではなく、精度評価には使わない。全値にmockと出典を付ける。

`contract-cases.json` は共通JSONへの置換を指定し、両言語で同じ受理/拒否を検証。`question-cases.json` は順位が変わるケースと、NPVが同額変わり順位差が変わらないケースの手作り行列。実案件結果や確率を装わない。質問ランキングはT09で実装する。
