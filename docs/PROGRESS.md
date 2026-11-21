# Реальный статус реализации

Baseline: 2026-11-20. **Это LAB-прототип, не защищённый мессенджер.**

## Новая диагностическая сборка для тестировщика

Код **`06da5e7a9dea0008c3069b6c2a5eb510bc09fbfd`**,
[run44902408154](https://github.com/Knox1986X/MeshChat/actions/runs/44902408154):
**все3 jobs success**. Rust tests/Clippy, Python11, native arm64-v8a/x86_64,
Android compile/lint, **9 JVM tests** (включая3 DiagnosticLogTest) и **8 реально
выполненных instrumented tests на AOSP API30 x86_64**. Последние8 не включают
UI/системный picker: ручной экспорт и hardware flow нужно проверить на телефоне.

Добавлены просмотр, очистка и явный экспорт `.txt` через системный CreateDocument.
Лог принимает только enum allowlist;256 событий в RAM, без ключей, alias, путей,
сообщений, exception text, stack traces, идентификаторов телефона или сети.
Отчёт содержит version/source revision/Android API. Автоотправки/INTERNET нет.
После process death/пересоздания Activity журнал теряется; crash/ANR сбор пока
не реализован. Экспортированный файл вне контроля LAB, удаляется отдельно.

[Скачать ZIP с диагностическим LAB APK](https://github.com/Knox1986X/MeshChat/actions/runs/44902408154/artifacts/14706956141)
(14,499,662 bytes; retention7d, может требоваться GitHub login).

- APK SHA256: `6449337b2caa0f97bb56505010ed0c98b36eaa0cc4751478f740ba67c3f7c895`.
- ZIP SHA256 GitHub API: `4319f17f68c2c30ef48241ca7cd11ebcbf8dbb92c53ffd359199a3d6abfd4d6d`.
- Внутри `MeshChat-LAB.apk` и `LAB_WARNING.txt`; debug-signed, не production.
- [Как тестировать и прислать отчёт](BETA_TESTING.md).
- Это подготовка к бете, **не полноценная бета мессенджера**: переписки/E2EE/сети нет.

SHA256/test evidence получено через checks/API; локально APK не скачан из-за
сетевой allowlist. Ниже сохранены предыдущие milestones с их собственными hashes.

## Текущий шаг: Rust lifecycle → реальный Android native bridge

Код **`67f0e3c`**, [run44895321204](https://github.com/Knox1986X/MeshChat/actions/runs/44895321204):
**все3 jobs success**. Проверено:

|Проверка нового шага|Фактическое evidence|
|---|---|
|Rust workspace6 crates|`cargo test --workspace --locked --offline` и Clippy `-D warnings` success; в исходниках46 unit tests (vault12, FFI4)|
|Native cross-build|arm64-v8a и x86_64 настоящие SQLCipher/Rust `.so`, Kotlin сгенерирован UniFFI; notice `Native LAB build`|
|Android compile/JVM/lint|6 JVM tests, debug APK и instrumentation APK build, lint success|
|AOSP API30 x86_64 emulator|8 instrumented tests реально выполнены:5 software-JCA contracts +3 Kotlin/JNA/UniFFI/SQLCipher lifecycle; failures/errors/skipped=0|
|Python|11 tests; `header-format` success|
|Физический телефон/StrongBox/TEE/BiometricPrompt|ЕЩЁ НЕ проверены; эмулятор это не доказывает|

### Новый LAB APK — не production messenger

[Скачать LAB ZIP](https://github.com/Knox1986X/MeshChat/actions/runs/44895321204/artifacts/14703887266)
(14,486,398 bytes, retention7d, GitHub login может требоваться).
Внутри `MeshChat-LAB.apk` и `LAB_WARNING.txt`. APK debug-signed временным runner key.

- APK SHA256: `3b81c5242bfadb0728e3c49770cd6180cf5d5c8388c195d6870fb2542ec88c29`.
- Artifact ZIP SHA256 из GitHub API: `b9483a10a86f32e58ea733003f83f88b1dbf97a7b623f8d07b17e89fff3dc3ac`.
- Exact source: `67f0e3c0c04bbd1b04cce95c7124e7bd0df1eb73`.
- APK не загружен локально из-за сетевой allowlist; SHA256/tests подтверждены
  checks annotations/GitHub API, а не локальным запуском на телефоне.

Добавлены `vault` и `ffi` (6 crates всего): одноразовые owner/generation-bound
unlock tickets, блокировка/терминальный shutdown, закрытие опубликованной SQLCipher
БД, отбрасывание позднего результата unlock, revocation при уничтожении FFI owner.
UniFFI0.29.4 API не экспортирует plaintext сообщений, SQL или сам ключ.
Cargo.lock обновлён штатным candidate Cargo; SHA256 публичного файла проверен.

Android LAB теперь вызывает create → count → lock → отказ доступа → reopen → lock
на временной пустой SQLCipher БД после двух hardware BiometricPrompt. На pause/cancel
отзывается native runtime, очистка сериализована после native worker; удаляются
временные файлы и созданный alias. Это НЕ persistent user vault. Cleanup — не forensic
erasure, а key copies в JVM/JNA/UniFFI/native providers не имеют доказанного zeroization.
In-flight SQLCipher open может временно удерживать ключ/handle после lock, но его
результат не публикуется и не даёт доступ через API.

CI теперь собирает реальные arm64-v8a/x86_64 `.so` (NDK27.2.12479018/API29),
генерирует Kotlin и требует AOSP API30 x86_64 instrumented tests до выдачи нового
APK artifact. Три native теста используют **публичный синтетический ключ**, без
StrongBox/биометрии. Это не замена тестам на реальном телефоне.

Далее после описания шага — **предыдущий полностью зелёный milestone**. Его APK НЕ содержит новых
native-возможностей; не смешивать его SHA256/evidence с текущей разработкой.

## Предыдущий milestone: выполнено

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

## Предыдущий milestone: CI evidence

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
настроек исправлены. Предыдущий полный milestone run44893599335 полностью зелёный.

Тесты process death действительно завершают дочерний процесс между UPDATE/INSERT/
COMMIT без Rust destructors, но **не имитируют физическое снятие питания/отказ SSD**.
SQLCipher DB/WAL canary test не доказывает отсутствие всех возможных форензик-следов
и не закрывает snapshot rollback/FS/memory-copy gates.
GitHub checks/annotations получены через API; хранилище сырых logs/артефактов
использует домены вне allowlist Arena, поэтому raw logs/APK в sandbox не загружены.
Не выдавать их отсутствие локально за отсутствие результата на GitHub.

## Предыдущий milestone: устаревший hardware-only APK

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
