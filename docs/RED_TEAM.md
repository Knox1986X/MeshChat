# Независимый враждебный аудит проекта

Scope: документированная архитектура, не код криптопротокола, которого ещё нет. Нет оснований писать «аудит пройден». Приоритет P0=блокирует выпуск, P1=высокий, P2=умеренный. Для P0 нужна отдельная повторная проверка и evidence, не checkbox автора.

|ID/сценарий|Последствие / затронутые|Приоритет|Архитектурная мера|Верификация|Остаточный риск|
|---|---|---|---|---|---|
|R01 Сговор ISP+CF+VPS|IP↔очереди/контакты, все|P1|не заявлять anonymity; независимость, bounded cover/batching|traffic correlation experiment blinded classifier|низкая latency остаётся сильным сигналом|
|R02 Классический OHTTP при HNDL|будущая расшифровка queue IDs|P0 B-NET-PQ|audited hybrid inner gateway, suite floor|known-answer/downgrade/interop и внешняя экспертиза|нет абсолютной PQ аутентичности Ed25519 в будущем|
|R03 Worker держит ключ «скрытый от CF»|CF читает ключ/маршруты, все B clients|P0|queue gateway/key за пределами CF в A/C|review deployment и key custody|operator collusion|
|R04 Подмена contact key/новая установка|MITM, переписка контакта|P0|IdentityChanged блокирует send; SAS/OOB|malicious directory/gateway replaces bundle|пользователь подтвердит не сверив|
|R05 Crash после send до ratchet commit|key/nonce reuse, plaintext loss|P0|atomic ratchet+immutable outbox до emit|power-cut injection на каждом write|filesystem/hardware bugs|
|R06 Restore старого ratchet|nonce reuse, replay|P0|history-only export, fresh install/channel/peer pairing|restore N-1, swap DB/checkpoint|невозможна universal hardware antirollback|
|R07 DB WAL/CoW старые chain keys|FS слабее заявления, изъятый носитель|P0 для заявленной FS|per-epoch external KEK destruction или ограничить guarantee|forensic snapshots с доступным current KEK|SSD/historical backups не стираем физически|
|R08 FGS бесконечный dataSync|Android15 остановит приём/скрытая задержка|P1|UnifiedPush, WorkManager best effort, bounded user task|24/72h OEM tests; timeout callback|OEM может убить всё|
|R09 USB detector пропустил кабель|keys остаются AFU|P1|screen lock независимо закрывает vault|кабели/OTG/USB role matrix|root/OS skip lock event|
|R10 signature permission preclaim/UID spoof|чужая Gallery украдёт media/geo|P0|verify owner/current cert/UID every call, explicit components|install malicious package первым, cross-user calls|APK signing key compromise|
|R11 desktop PID/hash TOCTOU, same UID injection|spoof trusted app, IPC secrets|P0 если обещана Android-grade isolation|sandbox/broker + signed package policy, no plugins|ptrace/DLL injection/replace exe tests|same-user/root endpoint компромисс не закрыт полностью|
|R12 IPC seq reset/replayed grant|повтор export/nonce reuse|P0|fresh handshake/key after restart, transactional effects|crash/cancel/replay counters|shared-root compromise|
|R13 decoder bomb/codec exploit|код в app, RAM exhaustion|P0|sandbox no network, bounds, patch/SBOM|fuzz corpora/decompression bombs|zero-day OS hardware codec|
|R14 EXIF/video atom/GPX XXE survives|координаты/имя камеры наружу|P0|decode/reencode allowlist, parser XXE off|metadata forensic corpus, negative tags scan|кадр/голос/PRNU всё ещё идентифицируют|
|R15 unencrypted temp/thumbnail/log|изъятие раскрывает контент|P0|encrypted all staging, generic notifications|filesystem+logcat/ProcMon forensic|IME/OS privileged copies|
|R16 Keystore StrongBox absent/error|тихое software fallback|P0|reported hardware level, explicit policy/consent TEE fallback; не fallback на plaintext|device без StrongBox, permanent invalidation|hardware bugs/vendor trust|
|R17 Signed malicious CI build|легитимная подпись spyware|P0|offline owner verify reproducible build+review+2person release|independent rebuild/injected source delta|owner computer/key compromise|
|R18 Захвачен GitHub/Dropbox/update CDN|rollback/freeze/replace APK|P0|TUF threshold roots, expiry/floor/hash+APK signer|tamper each role/version/hash|availability/freeze offline; clock ambiguity|
|R19 APK v4 принят вместо v2/v3|неверная проверка APK|P0|apksig verify exact bytes v2/v3+signer; v4 optional sidecar|unsigned/tampered/truncated APK|OS installer bugs|
|R20 VPS ACK до durable commit|потеря сообщения|P1|durable queue ACK, sender keeps encrypted copy до receipt/TTL|kill VPS after ACK boundary|Byzantine VPS can lie/drop, нельзя обеспечить delivery|
|R21 Reverse proxy access logs/API secrets|metadata archive/операторские ключи|P0 для секретов;P1 для log policy|disable app access logs, scrub traces, short RAM rate-limit|inspect CF/VPS config/telemetry/exports|CF/host сохраняют свои данные|
|R22 PoW ботнет/DoS через огромный ratchet jump|ресурсы у слабых клиентов/relay|P1|bounded cost, quotas, no derivation millions skipped keys|bot load, slowloris, overlimit|ботнет с бюджетом не устраним|
|R23 fallback direct при CF block|IP контакту/серверу без consent|P0|privacy-class gate до первого пакета|deny consent + pcap|user consent может быть неосознан|
|R24 battery/traffic cover default|DoS батареи/тариф, все|P1|caps, off background cover, trials|power monitor+pcap24h|cell padding всё равно дорого|
|R25 stale clocks/captive portal accept any TLS|MITM/update expiry bypass|P0|offline queue, clock error, no disable verify|clock±year/TLS interception|DoS без trusted time|
|R26 live location не остановилась/peer keeps|физическая опасность|P0|monotonic hard TTL, explicit indicator, stop on restore|reboot/clock jump/lock/permission revoke|получатель сохраняет координаты|
|R27 очередь rotate linking/graph inference|статистический граф контактов|P1|не обещать «сервер не может построить граф»; разные сессии/операторы|controlled contact graph correlation|полной защиты нет|
|R28 snapper/VSS/backup содержит KEK|duress/crypto erase не работает|P1|exclude container+wrap stores, encrypted disk, no deniability claims|restore snapshots, recover wraps|admin-controlled backup всё копирует|
|R29 unsupported Win10/старый Android|endpoint takeover|P1|support matrix/security servicing warning|OS policy checks|новые zero-days|
|R30 злой контакт злоупотребляет trust|скриншоты, пересылка, ложные receipts|P1|минимум данных, wording receipts|UI review/adversarial peer|E2EE не делает peer честным|

## Release blockers (запрет подписывать production APK)

- Открытые R02–R07 в затронутой заявленной функции; нет exact libsignal suite/continuous PQ PCS review или отсутствует независимый protocol audit.
- Нет утверждённого signing registry/exporter/crypto vectors, есть wildcard trust/debug roots/release debug flags, source license не согласована.
- Любой plaintext fallback, auto-accept changed identity, direct/proxy bypass без consent, DNS leak при strict policy.
- Nonce/key reuse, недетерминированное восстановление outbox, restore активных sessions или replay business effect.
- Любой открытый media/geo/temp/log/notification leak, несандбоксированный unbounded codec, передача DB key между apps.
- Непроверенный APK signer/rollback/update expiry, secrets в CI/Dropbox/Git, отсутствие independent rebuild evidence.
- Не работает unlock/lock cleanup на хотя бы одном поддерживаемом устройстве, crash вызывает потерю committed сообщения без диагностики.
- Необъявленные фоновые задержки OEM/Android15 или неприемлемые battery/traffic результаты без пересмотра SLO и UX; нельзя замаскировать это ложным «онлайн».

Исправление threat claim допустимо вместо невозможной гарантии только явно в спецификации/UX и с согласованием владельца; нельзя превратить mandatory PQ/E2EE в optional, чтобы формально закрыть blocker.
