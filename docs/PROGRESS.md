# Реальный статус реализации

Baseline: 2026-11-20. **Это LAB-прототип, не защищённый мессенджер.**

## Выполнено

1. Архитектура, threat matrix, Red Team, acceptance plan, local integration draft.
2. Dependency-free Rust workspace:
   - `eco-envelope`: bounded exact108-byte header, borrowed untrusted ciphertext/AAD/tag; нет AEAD/CBOR/replay/grants.
   - `session-policy`: unverified/changed identity blocks, stale UI challenge rejection, terminal revoke, history import требует re-pair; нет криптосессии/send API/storage.
   - `transport-policy`: consent перед повышением IP exposure, exact route/config binding, expiry/clock/SOCKS checks; нет сети и доказательства независимости операторов.
3. Android Kotlin/Compose `org.meshchat.lab`: отдельный LAB package, no INTERNET/no chats/no personal-data storage/no exported IPC; FLAG_SECURE, obscured touch rejection, backup exclusions, release variant disabled.
4. `AndroidKeyProtector` AES256-GCM AndroidKeyStore: hardware-only key, StrongBox default/explicit TEE option, per-use strong biometric auth, bounded wrapping format/AAD, одноразовые closeable операции, best-effort caller ByteArray wipe.
5. Реальный LAB-screen с явным consent: временный hardware key, два системных BiometricPrompt для wrap/unwrap случайного тестового key32, constant-time digest comparison, удаление только alias, созданного этим run. Не отображает/сохраняет plaintext key. TEE AlertDialog не сохраняет разрешение глобально.
6. `BiometricCoordinator`/`OperationGate`: stale/cross-operation callbacks rejected; cancel на onPause/screen-off, monotonic timeout60s, destroy terminal. При cleanup exception gate poisoned. Отмена main-thread callbacks предшествует cancel OS signal. Creation/deletion и provider setup сериализованы на worker.
7. Реальный GitHub Actions pipeline: Python checks, Rust tests+clippy, Kotlin compile+JVM tests+lint, debug APK и compile instrumented-test APK. Production signing keys не используются/не загружались. Нет production release.

## Фактическое CI evidence

Исходник: commit **`4f02c01d4f9da1a5ccfa4f668db84a5c07e5c84b`** в текущей ветке.
[GitHub Actions run44892385094](https://github.com/Knox1986X/MeshChat/actions/runs/44892385094) завершён **success** для всех3 jobs.

|Проверка|Подтверждённый результат|
|---|---|
|Python format/static guardrails|11 тестов прошли локально и job `header-format` в CI|
|Rust compile / unit tests / clippy|job `rust-core` success: `cargo test --workspace --locked --offline`, `cargo clippy ... -D warnings`;17 unit tests в3 crates|
|Android compile / JVM tests / lint|job `android-lab` success;6 `OperationGateTest` JVM tests прошли, failures/errors/skipped=0, lintDebug прошёл|
|Debug APK|`assembleDebug` success; подписан временным Android debug key runner, не ключом владельца|
|Instrumented tests|`assembleDebugAndroidTest` success — тестовый APK скомпилирован;5 `KeyProtectorContractTest` НЕ запускались, hardware tests НЕ проводились|
|Локальный grammar check|13 Rust/Kotlin/Gradle sources разобраны Tree-sitter; не заменяет компиляцию|
|Hardware StrongBox/TEE, BiometricPrompt, BFU/AFU, OEM/capture/backup|НЕ проверены на устройстве; успешная компиляция не доказывает поведение ОС|
|Independent security audit|НЕ проводился; Red Team документ — анализ архитектуры, не аудит готового мессенджера|

Первый CI run44891998358: Android прошёл, Rust упал. После устранения неоднозначности
`Self::Error` в enum с вариантом `Error` повторный run выше полностью зелёный.
GitHub checks/annotations получены через API; хранилище сырых logs/артефактов
использует домены вне allowlist Arena, поэтому raw logs/APK в sandbox не загружены.
Не выдавать их отсутствие локально за отсутствие результата на GitHub.

## Собранный LAB APK

[Скачать artifact ZIP — MeshChat-LAB-not-a-messenger](https://github.com/Knox1986X/MeshChat/actions/runs/44892385094/artifacts/14702656515)

- Artifact ID14702656515, размер ZIP8226126 bytes, retention7d. Может потребоваться вход в GitHub.
- Внутри `MeshChat-LAB.apk` и `LAB_WARNING.txt` с commit/hash/tests.
- **APK SHA256:** `a76abecbb4a81c61d6f15e9636c1174d922288a4410ef95d23ab45b6cae96672`.
- **ZIP digest** (не APK): `64c10cd960edb61b7bdaaef083d0d7c2d9632967ccb21858a17fc7a5a4484fc5`.
- APK hash сообщён CI notice, ZIP digest — GitHub artifact API. Сам файл не скачан
  в Arena из-за запрета исходящего доступа к backing blob storage; проверить APK
  hash самостоятельно после скачивания пользователем.

Это установочный файл аппаратного эксперимента, **не мессенджер для переписки**.
При отсутствии StrongBox/strong biometric ожидается отказ, не downgrade. Нужен
ручной тест на поддерживаемом Android; на OEM prompt может вызывать onPause и
строгую отмену — не ослаблять политику без анализа. Нормальная отмена удаляет
временный alias best effort; process kill/power loss может оставить orphan test
alias, что прямо указано в UI. Он не содержит пользовательской истории. Для
удаления таких следов можно удалить LAB-приложение.

## Что дальше

1. Установить LAB на реальные API29/30/31/35+ StrongBox/TEE устройства, выполнить
   hardware matrix, biometric success/cancel/no-enrollment/re-enrollment, экран/
   background/timeout/rotation/kill tests с записью только обезличенных результатов.
2. До production утвердить AGPL, package/cert registry и reviewed content-PQ,
   routing-PQ/local exporter profiles; не изобретать composition ради скорости.
3. Реализовать production installation/vault lifecycle, поддержку устройств без
   сильной биометрии без silent weakening, SQLCipher/atomic outbox/Zeroize core,
   затем reviewed crypto adapter и UniFFI, queues/media/geo/IPC/TUF.
4. Воспроизводимый build recipe, dependency verification, актуализация pinned CI
   actions (есть deprecation warnings Node20/setup-java-v4), hardware acceptance
   и независимый аудит до offline owner signing production APK.

## Не закрытые release blockers

Нет E2EE/аудированного PQ routing, DB/ratchet transactions, actual delivery,
production key/lock lifecycle, media sandbox, live ecosystem IPC, TUF updater,
reproducibility evidence или независимого code audit. Hardware wrapping adapter
скомпилирован, но безопасность на устройстве ещё не проверена. Полный перечень:
`RED_TEAM.md` и `ACCEPTANCE.md`. Проверка политики не является send permit;
`UntrustedHeader` не является аутентифицированным сообщением.
