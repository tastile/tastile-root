# 第三の実 mint host と PR 拒否

Root2778fe5 の実 job37572875556 は GitHub mint200 / Infisical403 を確認した。署名 token の ref は refs/pull/86/merge、event は pull_request。別 workflow job37572875651 は実 run-actions-1-azure-eastus.actions.githubusercontent.com で bearer 送信前に停止したため exact allowlist へ追加した。wildcard、bound claims、RBAC、TTL は変更しない。unit8cases31assertions成功。release allow と release別workflow拒否は未実施。
