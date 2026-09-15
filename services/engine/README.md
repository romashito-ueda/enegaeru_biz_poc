# TRACE local engine（Issue #4）

Python APIとネイティブ計算workerを分けるローカル実行基盤。外部データAPIキーは不要。**現在は入力検証用workerのみ**。PySAMによる発電・電池・投資計算はIssue #5〜#7で順に接続する。失敗をダミーの投資結果に置き換えない。

## 起動

リポジトリ直下でPython 3.12の独立環境を作る。

```powershell
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r services/engine/requirements.txt
.venv/Scripts/python.exe -m uvicorn trace_engine.api:app --app-dir services/engine --host 127.0.0.1 --port 8000 --workers 1
```

macOS/Linuxは `python3.12 -m venv .venv`、以降 `.venv/bin/python` に置換。別ターミナルで `npm ci`、`npm run dev`。UIの `/engine/*` をViteの開発プロキシが `http://127.0.0.1:8000/*` へ転送する。既存画面の計算切替はIssue #8で実装。APIとUIはそれぞれCtrl+Cで停止する。

`GET http://127.0.0.1:8000/health` で実行モード・上限・サービス起動IDを確認できる。1つのUvicornプロセスで起動する。`--workers` を増やすと独立したジョブ一覧ができるため、このPoCでは1を守る。WorkersデプロイへPythonを含める構成ではない。

## API

|操作|経路|応答|
|---|---|---|
|作成|POST /jobs|新規202、同一入力再利用200、`{job,reused}`|
|状態/結果|GET /jobs/{id}|200、`{job}`|
|キャンセル|POST /jobs/{id}/cancel|200、`{job}`。完了済みならその状態を返す|
|稼働状態|GET /health|200、モード/上限/起動ID|

作成JSONは `{input: SimulationInput, scope: {mode: "validation_only", scenarioIds: ["base"], years: 20}}`。`fixtures/generated/factory.json` 等をinputへ入れる。クライアントのhashは信用せず、サービスが共通契約を検証してhashを計算する。`mode: "simulation"` は現在409 ENGINE_UNAVAILABLE。

`lib/engine-client.ts` は作成・取得・キャンセル、応答検証とエラーの型を提供。UIは入力hash、対象シナリオ、編集revisionが現在の状態と一致する結果だけを採用する（revision制御はIssue #8）。

状態はqueued → running → succeeded / failed / cancelled。進捗はfraction（0〜1）とphase。ジョブには入力hash、モデル版、worker版、対象範囲、作成/終了時刻、サービス起動IDを持つ。入力本体・トレースバックは状態APIに含めない。検証用resultは `kind: "validation_only"`、区間数、需要合計、注意文を返す。

## 上限と寿命

|項目|初期上限|
|---|---:|
|同時worker|1プロセス|
|待ち行列|4件|
|1ジョブの候補|1設備構成（複数候補探索はIssue #10）|
|シナリオ|3件|
|入力/結果サイズ|4 MiB / 8 MiB|
|入力検証の同時実行|2件|
|worker時間|300秒（プロセス起動を含む）|
|保持件数|20件|
|完了後の保持/キャッシュ|900秒|

CPU計算はspawnした別プロセス、HTTP入力検証は別スレッド。同一inputHash＋scope＋worker版は待機中・実行中・成功結果を再利用。失敗/キャンセルは再試行で新ジョブ。TTL超過/保持件数超過では古い完了結果を破棄し、実行中は追い出さない。待機ジョブのキャンセルも待ち行列から除去する。

キャンセル/時間超過ではworkerを終了し、その後の結果を採用しない。新しいジョブは新しいプロセスと通信路で実行する。状態変更の競合でキャンセル要求時点ですでに成功していた場合は成功状態を維持する。API停止時は未完了をSERVICE_STOPPEDで終了する。

保存先はメモリのみ。**API再起動ですべてのジョブと結果が消える**。404 JOB_NOT_FOUNDはTTL切れや再起動を含み、再実行で回復する。UIの案件保存とジョブ保存は別の責務。

## エラー

QUEUE_FULL / VALIDATION_BUSYは429、入力サイズ超過は413、JSON以外は415、不正入力は422。計算開始後はTIME_LIMIT、WORKER_EXITED、WORKER_FAILED、WORKER_OUTPUT_INVALID、RESULT_TOO_LARGEを区別。利用者向け文言とretryableを返す。内部例外の文字列をそのまま公開しない。

## 検証と依存

```powershell
.venv/Scripts/python.exe -m unittest discover -s services/engine/tests -v
npm test
npm run typecheck
npm run contracts:check
npm run build
```

テストは実際にspawnした遅いworker、例外、異常終了、時間上限、キャンセル、重複、期限切れ、再起動、保持上限を検証。物理モデルの精度検証ではない。

`requirements.in` は直接依存、`requirements.txt` はPython 3.12の推移依存を含む固定版。過去の `work/engine-packages` には依存しない。更新時は新しいvenvでinstall → pip check → 全テストを行う。主要依存のライセンスは[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
