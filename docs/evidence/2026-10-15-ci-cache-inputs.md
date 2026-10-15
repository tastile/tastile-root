# 独立 target 間の実 compiler cache 入力

共有target版6429407がTIMEOUTとなったため、「candidateのcompile後、独立baseline targetはregistry outputを再利用できるか」を、固定642 sourceとtrusted9b baselineで実測した。新空target二つとbuild-localの新空1GiB sccache0.18を使い、実CI flags/jobs2でcandidate test no-run、別targetのbaseline api/worker buildを順に実行した。[source/input/hash metadata](2026-10-15-ci-cache-inputs.json)。

candidateは449miss/0hit、baselineは313hit/91miss（77.475%）、両phaseともerror/failure0。local cacheは最終425,382,260bytesで上限1GiB内だった。再利用は実在し、zero-reuse/容量不足/evictionを原因と断定できない。選択したheavy crateのfeatureは同じでも、一部のCargo metadata/compiler inputは異なる。aggregate statsだけでは91missを個別crateへ帰属できない。

compiler argvはCargo由来debuginfo1の後にCI debuginfo0を渡しており、最後の設定は0。ordinary APIとtest harness、baselineのordinary workerを区別してdigestを保存した。source blobは両archiveとcommit treeを照合し、cache daemon終了を確認した。local ARM4CPUの入力/reuse検証であり、hosted時間短縮・新cold10達成・wholePG/rollback証明ではない。追加build、gate削除、timeout/hardware/cache増加は行っていない。
