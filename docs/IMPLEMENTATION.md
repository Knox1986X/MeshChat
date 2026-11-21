# План реализации, поставка и эксплуатация

## 1. Порядок инженерных PR

Каждый шаг создаёт reviewable PR из текущей рабочей ветки с tests/evidence; агент не переключает ветку и не публикует ключи. Здесь код мессенджера сознательно не подменён неаудированными заглушками.

|Шаг|Работа|Definition of done / dependency|
|---|---|---|
|0|Утвердить threat assumptions, AGPL, IDs, политики, модели телефонов и владельцев ключей|ответы владельца, ADR, нет пустых allowlist в release|
|1|Freeze content protocol adapter, PQ routing profile, local exporter и wire vectors|external cryptographer review, exact commit/API/suites/licenses, downgrade corpus; иначе только lab|
|2|Rust workspace types/platform-api/store, CI pinned toolchains|SQLite crash tests, bounded parsing, cargo audit/deny/miri где применимо; actual Cargo.lock, не примерный|
|3|Android KeyProtector/lock/Compose, никаких сетевых чатов|instrumentation на hardware StrongBox/TEE/no-hardware, no silent software downgrade|
|4|Contact FSM+outbox+queue/ingress A/C|SAS substitution, crash/replay/failover, независимые operators; production keys вне CI|
|5|Gallery/Maps ecosystem SDK|межъязыковые vectors, UID/cert/replay/grant checks; unsafe integrations off|
|6|Sandbox media/chunks, offline geo, file bundles|metadata canaries, codec fuzz, ENOSPC/resume; low-end performance|
|7|UnifiedPush/poll UX, route policy, SLO trials|stock Xiaomi/Samsung/Huawei+GrapheneOS; de-Googled APK, no GMS dependency graph|
|8|TUF/APK offline release pipeline|2 independent reproducible builds, owner review/signing, tamper drills|
|9|External adversarial audit, release candidate|all P0 closed with evidence; launch only Android|
|10|CachyOS then Windows; subsequent optional modules|port KeyProtector/IPC/UI, same core vectors; no rewriting cryptography per platform|

## 2. Android фон — реализуемый контракт

FCM SDK/Google analytics отсутствуют в default dependency graph. UnifiedPush distributor выбирает пользователь; endpoint+auth не утекает в logs, relay coalesces wakeups, не содержит chat ID/plaintext/число сообщений. Регистрация push всё равно связывает устройство и события; per-app token, не общий на экосистему. Wake запускает разрешённую ОС bounded fetch задачу; encrypted cells можно скачать locked, decrypt только после unlock.

Без distributor: WorkManager periodic (минимальный период и Doze означают неточные интервалы), opportunistic poll при foreground/network available, exponential jitter. Foreground service только для реально допустимой user-visible задачи с правильным declared type/permissions. Android14 type declarations обязательны; Android15 target35 `dataSync` background budget суммарно6h/24h и ограничения старта из BOOT_COMPLETED применяются по платформенным правилам. `onTimeout` обрабатывается: flush encrypted progress, stopSelf, diagnostic. `remoteMessaging` не лазейка для произвольного server polling: применимость проверять по официальному описанию и тестам; `specialUse` не универсальное разрешение.

Пользователь может включить активный online mode, но indefinite background connection без подходящего OS-supported механизма **не обещать**. No wakelock24h/no AlarmManager abuse/no stealth process. Настройки OEM background/autostart объясняются с согласия пользователя, не выключаются тайно. Push disabled/OEM killed/Doze/force-stop показываются как потенциальная задержка, статус «онлайн» отсутствует по умолчанию. Force-stop может требовать ручного открытия. Live-location foreground type location требует отдельных runtime permissions/user action; MVP не запрашивает постоянный background location ради обычных чатов.

## 3. Обновления без доверия GitHub/Dropbox/Cloudflare

Выбор — полноценный TUF, а не изобретённый JSON с одной подписью. Root metadata встроена в APK; offline root threshold2-of-3 на раздельных физических носителях/местах. Targets offline2-of-3 (на старте допустим только согласованный owner ceremony, не секрет в CI); snapshot/timestamp также подписываются локальным release-station ключом с коротким сроком, не автоматически GitHub. Availability tradeoff: timestamp7d, snapshot30d, targets90d, root1y — проектные значения для процедуры, пересмотреть под реальный график. Пока владелец не обновил timestamp, клиент запрещает install с expired metadata, но работает локально. Offline месяц может потребовать свежий подписанный metadata bundle; старый APK не оправдывает expiry bypass.

Targets custom fields: `versionCode` int64, `versionName`, `platform`, `abi`, `minSupportedVersionCode`, `sourceCommit`, `buildRecipeHash`, `signerSha256`, `policyVersion`. TUF target length/hash SHA256 обязательно. Targets paths canonical relative, запрещены `..`, path collisions, redirects на unapproved schemes; download max bound и stream hash до установки. Клиент хранит максимальные TUF role versions и floor в защищённом local state; это antirollback в нормальной работающей установке, не абсолютная защита после полного rollback/переустановки. Android installed versionCode дополнительно ограничивает downgrade; свежую установку от старого подлинного APK офлайн полностью защитить невозможно без свежего внешнего anchor. Указать это пользователю.

Порядок APK: fetch bounded TUF metadata → root rotation verified старым И новым threshold → expiry/version/snapshot/targets consistency → download exact target → SHA256+length → Android `apksig` проверка схем v2/v3, certificate SHA256/approved proof-of-rotation lineage и packageName/versionCode → повторно hash того же открытого файла/защита TOCTOU → PackageInstaller с user consent. v3/v3.1 rotation compatibility отдельно тестируется; **v4 — отдельная incremental `.idsig`, не замена встроенной v2/v3 подписи и не обязательна для обычной установки**. Android framework проверяет опять. Запрос REQUEST_INSTALL_PACKAGES и «разрешить из источника» не обходятся. Signing key rotation — отдельная ceremony с поддержкой старых Android, не смена сертификата по любому signed manifest.

APK signer, TUF roots/targets, ecosystem registry signer, gateway config signer — разные ключи/роли. Общий APK signer для ecosystem apps имеет большой blast radius: доступ офлайн, минимум signing ceremony, revoke через policy root; потеря signer серьёзна, не лечится одним обновлением Dropbox. Configuration mirrors: GitHub Releases/Dropbox public artifact/CF/контакты, все недоверенные; config role отдельно подписана, у каждого route operator_id/privacy_class/suite floor/expiry. Config не разрешает wildcard contact key replacement. Clock skew не выключает expiry/TLS: показать local time error, предложить исправить часы/получить свежий authenticated bundle с независимого устройства; защититься от freeze при отсутствии trusted time полностью нельзя.

Windows: TUF+Authenticode/MSIX signer check, стандартный WinHTTP proxy с TLS validation и внутренним pinned tunnel; enterprise TLS interception не раскрывает внутренние keys/content, но видит outer traffic. Никаких AV evasion/packer/обфускации; стабильный publisher, SBOM, false positive submission, Authenticode timestamp, support policy. CachyOS: package-manager и app updater не соревнуются; AUR проверяет подпись source/release, PKGBUILD review, Flatpak repo key отдельно от TUF, AppImage внешняя подпись+manifest. Repro build baseline x86-64, optional source optimized build не публикуется как baseline.

## 4. Воспроизводимость и подпись владельцем

CI без release secrets: pinned Actions **по commit SHA после проверки**, minimal permissions contents:read, no pull_request_target execution untrusted code, ephemeral runners, no privileged docker, untrusted PR не получают release env. Rust exact stable/toolchain и deps lock после API prototype; Gradle wrapper hash, JDK/SDK/NDK/CMake exact versions, Gradle verification metadata, cargo vendor/source checksums, `SOURCE_DATE_EPOCH`, normalized paths/locale/timezone, offline build после fetch. Текущий workflow уже проверяет Python/Rust/JVM, компилирует/lint-ит Android LAB и собирает debug APK без production keys (evidence в PROGRESS.md). Это ещё не воспроизводимый production pipeline: wrapper/полная dependency verification/независимый rebuild/owner signing остаются обязательными отдельными gate.

1. CI генерирует unsigned reproducible APK, SBOM SPDX/CycloneDX, tests, provenance/commit/recipe hash; OIDC attestations полезны, не root of trust.
2. Второй независимый builder воспроизводит те же unsigned bytes. Сравнить SHA256 и diffoscope. Не обещать, что unsigned hash равен signed hash: signing изменяет APK.
3. Владелец на отдельной offline release station проверяет source/2 build hashes/SBOM, выполняет `apksigner` своим локальным ключом (пароль не в argv/logs/AI), проверяет подписанный APK.
4. Сохранить публичный certificate/approved lineage, signed artifact hash. Для независимой проверки подписанного APK — повторяемая сборка+проверенная процедура копирования исходного signing block (`apksigcopier`/эквивалент) без private key, если формат позволяет; сравнить exact signed bytes. Отклонение блокирует релиз, не «CI наверно норм».
5. Offline TUF metadata signing для exact signed artifact. Root keys хранятся отдельно, root ceremony редко; release-station защищён от переподписывания неподтверждённого build. Передать наружу **только** APK, public signatures/manifests/cert/SBOM/evidence.
6. GitHub/Dropbox/cloud mirror публикуют те же bytes. Никакого `.jks/.keystore/.p12`, приватного root/targets ключа, cloud token или production password в Arena/CI/Dropbox. Даже приватный репозиторий не исключение. Потерянный секрет считается скомпрометированным, revoke/rotate; удаление файла из HEAD не чистит history.

Реальные cloud credentials — отдельный secret manager/injection на managed server, least privilege, audited rotations; AI работает с inert example configs. Git hooks/CI gitleaks/trufflehog и binary allowlist после установки инструмента, `.gitignore` — не защита от утечки. Не писать fake fingerprints/keys «для удобства release»: пустой registry fail-closed.

## 5. Anti-spam и эксплуатация

По умолчанию queue TTL30d, max4096 cells/64MiB (metadata overhead отдельно), per-ingress admission quotas, total operator storage cap; expired ciphertext удаляется, но host backups вне контроля протокола. ACK delete после recipient durable commit; sender outbox до E2EE receipt/TTL. Storage at-rest VPS encrypted per-queue TTL key уменьшает риск stolen disk, не скрывает RAM от VPS root. Queue mostly RAM допустима только для некритичных transient states; ACK «durable» требует durable encrypted journal. Нет честного «всё только RAM» плюс гарантии пережить power loss.

Queue creation/first invite: short-lived signed challenge purpose+nonce+expiry+max_work; verifier дешёвый hash puzzle. Задача PoW подстраивается, но клиент имеет hard CPU/memory/time cap и право отказа от чрезмерной сложности. Memory-hard puzzle не автоматически mobile-friendly/cheap-to-verify: сначала benchmark, limit≤500ms p95 на слабом устройстве, не выдавать Argon2 password KDF за готовый anti-spam протокол. Батнет миллионы устройств PoW не останавливает; quota/admission tickets/invite caps основная защита, при необходимости prepaid/blind admission credentials отдельный audit. Нельзя логировать IP постоянно ради rate-limit: bounded RAM window ≤10min, rotating salt aggregate; криптографическая анонимность от этого не появляется.

Метрики: количество агрегированных errors/bytes/cells/queue capacity, CPU/RAM/p95 service latency histogram с coarse buckets, active queues в coarse buckets. Никаких raw IP, queue tokens/IDs, request IDs, cell-specific timestamps, contact fingerprints, координат, crash memory dumps. Экспорт ≥15min aggregate buckets, suppression малых групп (<20 samples), retention7d. Привязка counters к domain/queue/device запрещена. На входе IP всё равно доступен для соединения; «zero-log» означает политика оператора, не отсутствие наблюдения CF/хостером. Отключить nginx access logs, query logging, CF Worker logs/trace sampling/Logpush где доступно, проверять billing/security analytics. Диагностика клиента локальная redacted, отправка только opt-in после preview и без secrets.

Incidents: stop affected admission/update role → signed revocation через независимые mirrors → pin/floor checks без peer trust reset → owner communication → evidence synthetic/redacted → rotate compromised credentials. При захвате gateway keys не считать E2EE identity keys украденными, но считать metadata скомпрометированной. При APK signing key compromise остановить ecosystem auto-pair/grants по registry revocation и выпускать recovery plan с независимым policy root; offline clients ещё уязвимы.

## 6. GitHub monorepo и Dropbox

```
GitHub MeshChat/
  README.md, AI_ECOSYSTEM_HANDOFF_GUIDE.md
  docs/{ARCHITECTURE,RED_TEAM,ACCEPTANCE,IMPLEMENTATION,SOURCES}.md
  specs/                       # immutable versioned formats/vectors
  crates/, apps/, services/     # по workspace blueprint, после protocol freeze
  integration-tests/, fuzz/    # synthetic corpus, property/fault tests
  packaging/{android,aur,flatpak,appimage,windows}/
  release/{public-roots,recipes,manifests}/ # ТОЛЬКО public artifacts
  tools/, .github/workflows/
Dropbox /MeshChat-Engineering/
  00-Index/                    # doc version, source commit, SHA256 index
  01-Approved-Architecture/    # snapshots утверждённых GitHub docs
  02-Ecosystem-Specs/          # guide, public registry, vectors
  03-Audits/                  # sanitised external reviews
  04-Synthetic-Test-Traces/    # только искусственный трафик/агрегаты
  05-Public-Release-Artifacts/ # public signed manifests, SBOM, hashes
  06-Operations-Runbooks/      # без адресов админки/паролей/секретов
```
Новые сервисы/приложения могут быть отдельными репо с tagged `ecosystem-sdk`, но protocol docs остаются в одном versioned source of truth. AI task = один модуль/trait+negative tests+ADR, не «перепиши всё с любым crypto». Dropbox sync лишь публичного snapshot. Этот сеанс не должен чистить Dropbox или перезаписывать существующие файлы без отдельного запроса; подключение само по себе не разрешает разрушать его содержимое.
