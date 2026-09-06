<!-- 日本語訳 / Translation -->
# KMS スロットリングインシデント対応

CI が `ThrottlingException: KMS.Decrypt` で失敗した場合:

1. **リージョンとサービスクォータを確認する**

   ```bash
   aws service-quotas get-service-quota --service-code kms --quota-code L-C2DCB1FB --region ap-northeast-1
   ```

   デフォルト: 5500 req/s。トラフィックがクォータを下回っていれば AWS サポートに連絡する。

2. **復号頻度を下げる**

   sops は各 `.env.<env>.sops` を CI ジョブごとに 1 回ずつ復号する。
   同一ワークフロー実行内のジョブ間で、復号済みファイルを `actions/cache@v4` を使い
   sops ファイルの SHA256 をキーにしてキャッシュする。

3. **sops 内部リトライへの依存**

   loader 自体にはリトライコードはなく、sops 同梱の AWS-SDK リトライ
   (デフォルトで指数バックオフで約 3 回) を通じて一時的な `ThrottlingException` を
   処理する。sops の内部リトライを使い切った場合、loader は非ゼロで終了し、
   systemd ユニット / CI ジョブは失敗する。スロットリングが継続する場合は、
   ステップ 4 (クォータ引き上げ) またはステップ 2 (同一ワークフロー実行内の
   ジョブ間で復号済みファイルを `actions/cache@v4` でキャッシュする) に従う。

4. **クォータの引き上げ**

   AWS Support Center 経由で申請する。想定 turnaround は 24〜48 時間。
   ワークロードの説明とリージョンを添えて提出する。
