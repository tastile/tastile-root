# CI source binding の dev 配備と自動復旧

Root PR90 の確定 source SHA 注入を、source54adf15／image digest64f3／revision00003-6d7へ配備した。実 Cloud Build publisher が成功し、独立 review 済み plan は dev service image 1件だけの update。Ready と Scheduler200を確認した。[詳細 metadata](2026-10-14-ci-source-binding-runtime.json)。

そこから生まれた「投入処理が途中で失われても、重複 build を作らず回復できるか」を実運用で確認した。Core3d7b0dの最初の request は proxy／instance接続による503で失われた。正確な機構は未確定で OOM と断定しない。source upload後のpreparing leaseは5分後にgeneration fencingで回収され、同じimmutable sourceからbuild8499d6f4が1件だけ作られた。manual submission／lock削除／submittingの強制再投入は行っていない。

これはdev配備と準備lease復旧の証跡であり、新Core recipeのbuild完了、25分、cold10中央値、Issue50/204/全移行の完了はまだ証明しない。GCP runtimeの実態が正本で、architecture modelのtarget lifecycleはplannedのまま維持する。dev currentの観測はproviderとこのevidenceで追跡する。
