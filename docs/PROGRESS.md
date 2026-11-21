# Реальный статус реализации

Baseline: 2026-11-20. **Это LAB-прототип, не защищённый мессенджер.**

## Выполнено

1. Архитектура, threat matrix, Red Team, acceptance plan, local integration draft.
2. Rust workspace (политики/парсер без dependencies; store использует pinned SQLCipher/Zeroize):
   - `eco-envelope`: bounded exact108-byte header, borrowed untrusted ciphertext/AAD/tag; нет AEAD/CBOR/replay/grants.
   - `session-policy`: unverified/changed identity blocks, stale UI challenge rejection, terminal revoke, history import требует re-pair; нет криптосессии/send API/storage.
   - `transport-policy`: consent перед повышением IP exposure, exact route/config binding, expiry/clock/SOCKS checks; нет сети и доказательства независимости операторов.
   - `store`: SQLCipher4 encrypted DB/WAL, Zeroizing secret buffers, atomic outbox+ratchet revision, duplicate/CAS/quota checks, immutable ciphertext retries, bounded paging, monotonic relay claims. 13 tests включают3 process-death checkpoints, конкурирующие соединения, wrong key/installation, DB/WAL plaintext canary и strict pragma checks. Не подключён к Android/реальному ратчету; payload encryption не реализует. Подробный контракт и остаточные риски — `STORE.md`.
3. Android Kotlin/Compose `org.meshchat.lab`: отдельный LAB package, no INTERNET/no chats/no personal-data storage/no exported IPC; FLAG_SECURE, obscured touch rejection, backup exclusions, release variant disabled.
4. `AndroidKeyProtector` AES256-GCM AndroidKeyStore: hardware-only key, StrongBox default/explicit TEE option, per-use strong biometric auth, bounded wrapping format/AAD, одноразовые closeable операции, best-effort caller ByteArray wipe.
5. Реальный LAB-screen с явным consent: временный hardware key, два системных BiometricPrompt для wrap/unwrap случайного тестового key32, constant-time digest comparison, удаление только alias, созданного этим run. Не отображает/сохраняет plaintext key. TEE AlertDialog не сохраняет разрешение глобально.
6. `BiometricCoordinator`/`OperationGate`: stale/cross-operation callbacks rejected; cancel на onPause/screen-off, monotonic timeout60s, destroy terminal. При cleanup exception gate poisoned. Отмена main-thread callbacks предшествует cancel OS signal. Creation/deletion и provider setup сериализованы на worker.
7. Реальный GitHub Actions pipeline: Python checks, Rust tests+clippy, Kotlin compile+JVM tests+lint, debug APK и compile instrumented-test APK. Production signing keys не используются/не загружались. Нет production release.

## Фактическое CI evidence

Исходник: commit **`fbc30bd93d4ef919ec0abd9f58f7d59842aa20c6`** в текущей ветке.
[GitHub Actions run44893599335](https://github.com/Knox1986X/MeshChat/actions/runs/44893599335) завершён **success** для всех3 jobs. Он использует уже закоммиченный Cargo.lock, `cargo fetch --locked`, затем offline tests/clippy; unlocked dependency candidate не считается release approval.

|Проверка|Подтверждённый результат|
|---|---|
|Python format/static guardrails|11 тестов прошли локально и job `header-format` в CI|
|Rust compile / unit tests / clippy|job `rust-core` success: `cargo test --workspace --locked --offline`, `cargo clippy ... -D warnings`;30 unit tests в4 crates (13 в SQLCipher store)|
|Android compile / JVM tests / lint|job `android-lab` success;6 `OperationGateTest` JVM tests прошли, failures/errors/skipped=0, lintDebug прошёл|
|Debug APK|`assembleDebug` success; подписан временным Android debug key runner, не ключом владельца|
|Instrumented tests|`assembleDebugAndroidTest` success — тестовый APK скомпилирован;5 `KeyProtectorContractTest` НЕ запускались, hardware tests НЕ проводились|
|Локальный grammar check|15 Rust/Kotlin/Gradle sources разобраны Tree-sitter; не заменяет компиляцию|
|Hardware StrongBox/TEE, BiometricPrompt, BFU/AFU, OEM/capture/backup|НЕ проверены на устройстве; успешная компиляция не доказывает поведение ОС|
|Independent security audit|НЕ проводился; Red Team документ — анализ архитектуры, не аудит готового мессенджера|

Первый CI run44891998358: Android прошёл, Rust упал; неоднозначность `Self::Error`
исправлена и run44892385094 прошёл. При добавлении store кандидат упал из-за чтения
SQLCipher pragma TEXT как INTEGER; строгий парсер обоих типов и проверка отсутствующих
настроек исправлены. Последний run44893599335 полностью зелёный.

Тесты process death действительно завершают дочерний процесс между UPDATE/INSERT/
COMMIT без Rust destructors, но **не имитируют физическое снятие питания/отказ SSD**.
SQLCipher DB/WAL canary test не доказывает отсутствие всех возможных форензик-следов
и не закрывает snapshot rollback/FS/memory-copy gates.
GitHub checks/annotations получены через API; хранилище сырых logs/артефактов
использует домены вне allowlist Arena, поэтому raw logs/APK в sandbox не загружены.
Не выдавать их отсутствие локально за отсутствие результата на GitHub.

## Собранный LAB APK

[Скачать artifact ZIP — MeshChat-LAB-not-a-messenger](https://github.com/Knox1986X/MeshChat/actions/runs/44893599335/artifacts/14702644758)

- Artifact ID14702644758, размер ZIP8226123 bytes, retention7d. Может потребоваться вход в GitHub.
- Внутри `MeshChat-LAB.apk` и `LAB_WARNING.txt` с commit/hash/tests.
- Это по-прежнему только аппаратный тест: новый Rust store в APK ещё **не подключён**.
- **APK SHA256:** `2f585930a812511eaeebd9886e8329522d24f6154bbc691844b3d61287775f3e`.
- **ZIP digest** (не APK): `70292243f64f82c9196c2c57cfbeac4cb4f71a7e7b4f1f0499475e2313f354a9`.
- Эфемерные debug-signing сертификаты разных CI runs могут отличаться: для замены
  старого LAB может потребоваться удалить именно `org.meshchat.lab`. Это не канал
  обновлений будущего production клиента и не повод автоматически доверять новым ключам.
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
   сильной биометрии без silent weakening; подключить store через UniFFI, lifecycle
   DB close/secret revocation, inbound transaction и verified receipt cleanup. Затем
   reviewed crypto adapter, queues/media/geo/IPC/TUF. Snapshot rollback и forensic
   FS требуют отдельной внешней key/checkpoint политики.
4. Воспроизводимый build recipe, dependency verification, актуализация pinned CI
   actions (есть deprecation warnings Node20/setup-java-v4), hardware acceptance
   и независимый аудит до offline owner signing production APK.

## Не закрытые release blockers

Нет E2EE/аудированного PQ routing, интеграции DB с настоящим ратчетом/Android,
inbound replay/decrypt transaction, actual delivery, production key/lock lifecycle,
media sandbox, live ecosystem IPC, TUF updater,
reproducibility evidence или независимого code audit. Hardware wrapping adapter
скомпилирован, но безопасность на устройстве ещё не проверена. Полный перечень:
`RED_TEAM.md` и `ACCEPTANCE.md`. Проверка политики не является send permit;
`UntrustedHeader` не является аутентифицированным сообщением.
