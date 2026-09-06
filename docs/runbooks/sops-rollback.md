<!-- 日本語訳 / Translation -->
# sops ロールバック

本番環境で sops 復号が失敗し、AWS SSM Parameter Store がまだ動作している場合は:

1. **loader のデプロイを巻き戻す**

   ```bash
   git checkout <last-good-tag>
   ```

   既存の deploy スクリプトで過去の成果物を再デプロイする。

2. **SSM から平文 .env を復元する**

   ```bash
   aws ssm get-parameters --names /tastile/web/.env.production --with-decryption --query 'Parameters[*].Value' --output text > /opt/tastile-web/.env.production
   chmod 600 /opt/tastile-web/.env.production
   systemctl restart tastile-web
   ```

3. **KMS Decrypt 権限を取り消す**

   ```bash
   aws kms put-key-policy --key-id <prod-key-id> --policy file://deny-decrypt.json --policy-name default
   ```

   (または Terraform で EC2 instance profile の attachment を外す。)

4. **CI の復号ジョブを無効化する**

   `.github/workflows/build.yml` で `decrypt` ジョブを `if: false` に設定する。
   (注: リポジトリごとの実ワークフローファイルは `ci.yml` / `quality.yml` / `deploy.yml` — Task 6 のリポジトリ別マッピングを参照。)

5. **systemd で loader を無効化する**

   `ops/systemd/tastile-web.service.example` の `ExecStartPre=` 行をコメントアウトし、
   `systemctl daemon-reload` を実行する。

## 注意

`.env.<env>.sops` の暗号文は git 履歴に残り続けるが、これは意図的な動作である。
ファイルを削除しても漏洩は元に戻らない。KMS アクセスの取り消しが真の対策となる。

## ADR 0006 との整合

key policy の `kms:ViaService = s3.<region>.amazonaws.com` 条件は commit `882541b` で
削除済み (ADR `docs/adr/0006-kms-viaservice-removal.md`)。 Troubleshooting 中に
この条件を復活させると、SSO 直接 `kms:Decrypt` が `AccessDenied` で失敗し、IAM
principal リストが正しくても loader が `.env.<env>.sops` を復号できなくなる。
