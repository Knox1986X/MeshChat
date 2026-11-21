# Реальный статус реализации

Дата: 2026-11-20. Никакого готового защищённого мессенджера/production APK пока нет.

## Выполнено

1. Архитектура, threat matrix, Red Team, тест-план, local integration draft.
2. Dependency-free Rust workspace с тремя небольшими библиотеками:
   - `meshchat-eco-envelope`: exact108-byte big-endian header, bounded payload/envelope, unknown/reserved/version rejection, borrowed ciphertext/AAD/tag. Парсер никогда не обозначает данные проверенными. AEAD/CBOR/replay/grants отсутствуют.
   - `meshchat-session-policy`: in-memory trust prerequisite, changed-key hard stop, stale challenge rejection, terminal revoke, history restore requires new pairing. Нет libsignal, durable storage, nonce state или send API.
   - `meshchat-transport-policy`: explicit consent перед QueueSeesClientIp/PeerSeesClientIp, привязка ко всей конфигурации/маршруту, запрет обхода required SOCKS, expiry/clock rollback и same-operator checks. Сетевого adapter ещё нет, operator IDs не доказывают независимость компаний.
3. Пять Rust-тестов формата, пять тестов доверия и семь тестов transport-policy подготовлены. Общий Python/Rust header fixture лежит в `specs/vectors`. Это первый шаг к interoperability corpus, не crypto vectors.
4. Android `org.meshchat.lab`: Compose status screen без пользовательского ввода/сети/хранилища, FLAG_SECURE, overlay touch rejection, backup/cloud/device-transfer exclusions. Production package/signing identity не используется, release variant выключен. Ни один ключ или секрет не создавался.
5. CI дополнен Rust test/clippy job. Python tests дополнены static manifest/backup guards. Android Gradle configs подготовлены, APK pipeline пока отсутствует.
6. Добавлен исходник `AndroidKeyProtector` (не интегрирован в UI): AES256-GCM AndroidKeyStore, hardware level check, per-use strong biometric auth, явный выбор StrongBox/TEE без software fallback, AAD vault/alias binding, одноразовые closeable операции и best-effort wipe caller ByteArray. Подготовлены5 instrumented operation/format tests на public synthetic software JCA keys; они НЕ тестируют StrongBox и biometric enforcement. Нет prompt UI/lock manager и credential fallback; adapter не выполнялся, реальных keys не создавал.

## Что действительно проверено в рабочем окружении

|Проверка|Результат|
|---|---|
|`python3 -m unittest discover -s tests -v`|11 тестов прошли|
|`git diff --check`|прошёл|
|`tools/check_source_syntax.py` (isolated venv)|Tree-sitter grammar parse9 Rust/Kotlin/Gradle sources прошёл; это НЕ компиляция и не проверка API/types|
|Rust compilation / unit tests / clippy|НЕ выполнялись: rustc/cargo отсутствуют; workflow подготовлен, результат CI неизвестен|
|Kotlin/Gradle compilation / APK installation|НЕ выполнялись: JDK/Gradle/Android SDK отсутствуют, Google Maven вне сетевого allowlist|
|Hardware Keystore, FLAG_SECURE, OEM background tests|НЕ выполнялись; исходник wrapping adapter подготовлен, hardware/biometric enforcement не проверены; lifecycle/background ещё отсутствуют|
|KeyProtector operation/format tests|5 instrumented тестов подготовлены, НЕ запускались; используют synthetic software cipher, не hardware path|
|Independent protocol/security audit|НЕ проводился; Red Team документ — анализ проекта, не аудит готового кода|

Нет попыток замаскировать Python static checks под Android instrumented tests. Не выдавать результат `UntrustedHeader::parse` за проверку подписи/tag. В `session-policy` OOB confirmation — модель доверенного пользовательского действия, не доказательство криптографической подлинности; полноценный adapter обязан предоставить authenticated handshake binding и устойчивую транзакционную запись до send.

## Что дальше

1. На подготовленном build runner скомпилировать Rust/Kotlin, выполнить tests/clippy/Android lint, исправить фактические ошибки. Отладочный APK допустим только с явным LAB-статусом, не для реальной переписки.
2. Утвердить владельцем AGPL и реальные IDs/cert registry; независимо проверить content PQ suite, routing PQ profile и local handshake exporter. Пока они открыты, не реализовывать сомнительную криптографическую композицию ради быстрого APK.
3. Скомпилировать/проверить подготовленный AndroidKeyProtector; реализовать BiometricPrompt, lifecycle/lock events и hardware instrumentation на StrongBox/TEE, включая failure/cancel/invalidation. Затем storage/outbox с crash tests и Zeroize secrets. Сейчас никакие реальные secrets не хранятся; best-effort ByteArray.fill(0) не означает очистку всех JVM/OS copies.
4. Подключить pinned reviewed crypto adapter и UniFFI; реализовать реле/transport policy, SAS, media/geo, IPC и update verification.
5. Собрать и подписать production APK **только** после закрытия release blockers, real-device tests и локальной подписи владельцем. Production signing keys не запрашивать у владельца в чате и не добавлять в CI.

## Не завершённые обязательные release gates

Точный перечень: `docs/RED_TEAM.md`, `docs/ACCEPTANCE.md`. В частности отсутствуют E2EE, audited PQ routing, аппаратное wrapping, encrypted DB, transactional queues, медиа sandbox, живой IPC, доставка, TUF updater, воспроизводимая Android-сборка и внешняя проверка. Разделять «исходники LAB-оболочки» и «защищённый мессенджер» обязательно.
